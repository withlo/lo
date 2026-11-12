/**
 * How long a figure's shapes can be, at most, in their own units, and so how many dashes a dash
 * pattern draws along them. A browser draws up to a million dashes on one path, each as much work
 * as a shape, so a figure is charged for each. The lengths are upper bounds: a curve is no longer
 * than the polygon of its control points, and an arc no longer than the whole ellipse it's part of.
 * Dash counts don't change with scale, so no transform matters.
 *
 * A browser keeps a path's points as 32-bit floats, so they're rounded here the same way: near a
 * million, a float32 is a sixteenth apart, and a step of 0.01 there is a sixteenth long, six times
 * as long. A browser's own parsing can read a number a few floats away from the one read here, so
 * each segment is allowed 8 float32 steps more, at the largest coordinate of what it's part of: a
 * few millionths near the origin, half a thousandth near a thousand, a half near a million.
 * Anything that doesn't come out finite is as long as can be.
 *
 * Dash patterns are also kept to a period of at least `MIN_DASH_PERIOD`, so a unit of a length
 * holds no more dashes than the pattern has numbers. That doesn't free the count from how a browser
 * rounds a float: a pattern of many tiny numbers that add up to 1, such as 2,001 of 0.0005, draws a
 * thousand dashes a unit, so a browser that finds a path half a unit longer than it reads here
 * draws five hundred more. Only each segment's slack counts those.
 */

const f = Math.fround;

/**
 * How many float32 steps longer a browser may find each segment than its points read here. A
 * browser's number parser can read a number up to 4 float32 steps from where it's read here, and a
 * segment runs between two of them.
 */
const SLACK_STEPS = 8;

/**
 * The least a dash pattern's period may be, in the element's own units. Below it, a unit of the
 * shape holds more than a run of the pattern, and how a browser rounds a length or a point decides
 * how many dashes it draws. At it or above, a pattern of many numbers still draws up to as many
 * dashes a unit as it has numbers, and as many more for each unit a browser's rounding adds, which
 * only the slack counts.
 */
export const MIN_DASH_PERIOD = 1;

/** The segments a browser draws an arc with, at most: four cubic curves of three edges each. */
const ARC_SEGMENTS = 12;

const bits = new DataView(new ArrayBuffer(4));

/** The step from the float32 nearest `magnitude` to the next one up. */
export function float32Step(magnitude: number): number {
  const at = f(Math.abs(magnitude));
  if (!Number.isFinite(at)) return Infinity;
  bits.setFloat32(0, at);
  bits.setUint32(0, bits.getUint32(0) + 1);
  return bits.getFloat32(0) - at;
}

/**
 * How much longer `segments` segments may be in a browser, their points at most `most` from the
 * origin: a few float32 steps each, however a browser rounds what it reads.
 */
export function slack(segments: number, most: number): number {
  return segments * SLACK_STEPS * float32Step(most);
}

/** The distance between two points. */
function distance(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0);
}

/**
 * At most how long an arc from (x0, y0) to (x1, y1) is, on an ellipse of radii `rx` and `ry`
 * turned `angle` degrees: the whole ellipse, its radii first scaled up, as SVG scales them, until
 * it reaches from one end to the other. With a radius of zero, it's a straight line.
 */
export function arcLength(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  angle: number,
  x1: number,
  y1: number,
): number {
  if (rx === 0 || ry === 0) return distance(x0, y0, x1, y1);
  const a = Math.abs(rx);
  const b = Math.abs(ry);
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const x = cos * dx + sin * dy;
  const y = -sin * dx + cos * dy;
  const reach = (x * x) / (a * a) + (y * y) / (b * b);
  // Radii whose squares underflow make this 0 / 0: no bound at all, rather than a tiny one.
  if (!Number.isFinite(reach)) return Infinity;
  const scale = reach > 1 ? Math.sqrt(reach) : 1;
  return 2 * Math.PI * Math.max(a, b) * scale;
}

/**
 * Follows a path's commands, as SVG's grammar reads them, adding up at most how long it is: each
 * line, each curve's control polygon (a smooth curve's reflected control point included), each
 * arc's whole ellipse, and each close back to where its subpath began.
 */
export class Pen {
  /** How long the path is so far, as its points read here. */
  private length = 0;
  /** How many segments it's drawn with, for the slack each is allowed. */
  private segments = 0;
  /** The largest coordinate it reaches, either way. */
  private most = 0;
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  /** The last cubic curve's second control point, which a smooth one reflects. */
  private cubic: [number, number] | undefined;
  /** The last quadratic curve's control point, which a smooth one reflects. */
  private quadratic: [number, number] | undefined;

  /** One group of `command`'s numbers; `first` when it's the command's first. */
  draw(command: string, values: readonly number[], first: boolean): void {
    const lower = command.toLowerCase();
    const relative = command === lower;
    // In 32-bit floats, as a browser adds them up.
    const ox = relative ? this.x : 0;
    const oy = relative ? this.y : 0;
    const raw = (index: number): number => f(values[index] ?? 0);
    const at = (index: number): number => f((index % 2 === 0 ? ox : oy) + raw(index));
    let cubic: [number, number] | undefined;
    let quadratic: [number, number] | undefined;
    switch (lower) {
      case 'm':
        if (first) {
          this.x = at(0);
          this.y = at(1);
          this.reach(this.x, this.y);
          this.startX = this.x;
          this.startY = this.y;
        } else {
          this.to(at(0), at(1));
        }
        break;
      case 'l':
        this.to(at(0), at(1));
        break;
      case 'h':
        this.to(f(ox + raw(0)), this.y);
        break;
      case 'v':
        this.to(this.x, f(oy + raw(0)));
        break;
      case 'c':
        cubic = [at(2), at(3)];
        this.via([at(0), at(1), ...cubic, at(4), at(5)]);
        break;
      case 's':
        cubic = [at(0), at(1)];
        this.via([...this.reflect(this.cubic), ...cubic, at(2), at(3)]);
        break;
      case 'q':
        quadratic = [at(0), at(1)];
        this.via([...quadratic, at(2), at(3)]);
        break;
      case 't':
        quadratic = this.reflect(this.quadratic);
        this.via([...quadratic, at(0), at(1)]);
        break;
      case 'a': {
        // Radii and angle are no points: not offset. The end is.
        const x = f(ox + raw(5));
        const y = f(oy + raw(6));
        const arc = arcLength(this.x, this.y, raw(0), raw(1), raw(2), x, y);
        this.length += arc;
        this.segments += ARC_SEGMENTS;
        // Every point of its ellipse is within its diameter, at most the bound over pi, of an end.
        this.reach(this.x, this.y, arc / Math.PI);
        this.reach(x, y, arc / Math.PI);
        this.x = x;
        this.y = y;
        break;
      }
      case 'z':
        this.to(this.startX, this.startY);
        break;
      default:
        // A command from a figure that isn't SVG's: no bound on how long it is.
        this.length = Infinity;
    }
    this.cubic = cubic;
    this.quadratic = quadratic;
  }

  /** At most how long the path is: as its points read here, and the slack each segment has. */
  get bound(): number {
    return this.length + slack(this.segments, this.most);
  }

  /** A line to (x, y). */
  private to(x: number, y: number): void {
    this.length += distance(this.x, this.y, x, y);
    this.segments += 1;
    this.reach(x, y);
    this.x = x;
    this.y = y;
  }

  /** Notes that the path reaches as far as (x, y), and `beyond` further. */
  private reach(x: number, y: number, beyond = 0): void {
    this.most = Math.max(this.most, Math.abs(x) + beyond, Math.abs(y) + beyond);
  }

  /** A curve's control polygon: lines through `points`, pairs of numbers, the last its end. */
  private via(points: readonly number[]): void {
    for (let i = 0; i + 1 < points.length; i += 2) this.to(points[i]!, points[i + 1]!);
  }

  /** `control` reflected through the current point, or the current point when there's none. */
  private reflect(control: [number, number] | undefined): [number, number] {
    return control ? [f(2 * this.x - control[0]), f(2 * this.y - control[1])] : [this.x, this.y];
  }
}

/**
 * At most how long the lines through `values` are, pairs of numbers, closed when `closed`, with
 * each segment's slack.
 */
export function polylineLength(numbers: readonly number[], closed: boolean): number {
  const values = numbers.map(f);
  let length = 0;
  let segments = 0;
  for (let i = 2; i + 1 < values.length; i += 2) {
    length += distance(values[i - 2]!, values[i - 1]!, values[i]!, values[i + 1]!);
    segments += 1;
  }
  if (closed && values.length >= 4) {
    length += distance(values.at(-2)!, values.at(-1)!, values[0]!, values[1]!);
    segments += 1;
  }
  const most = values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  return length + slack(segments, most);
}

/**
 * How long one run of the dash pattern `pattern` is: the sum of its numbers, and, as SVG repeats a
 * pattern of an odd count of numbers to make an even one, twice that when the count is odd.
 */
export function dashPeriod(pattern: readonly number[]): number {
  const sum = pattern.reduce((total, value) => total + value, 0);
  return pattern.length % 2 === 0 ? sum : 2 * sum;
}

/**
 * A browser sums a path's length in 32-bit floats too, and over tens of thousands of segments the
 * sum can come out a little longer: a hundredth more covers it.
 */
const SUM_MARGIN = 1.01;

/**
 * At most how many dashes `pattern`, the numbers of a dash array, draws along `length`. A pattern
 * of an odd count of numbers is repeated to make an even one, so either way it draws half as many
 * dashes as it has numbers in each run of their sum; one more of each for where the pattern starts.
 * A pattern of zeros draws a solid line. A length that isn't finite has no end of dashes.
 */
export function dashCount(pattern: readonly number[], length: number): number {
  const period = pattern.reduce((sum, value) => sum + f(value), 0);
  if (period <= 0) return 0;
  const count = Math.ceil((length * SUM_MARGIN * pattern.length) / (2 * period)) + pattern.length;
  // A length that isn't finite, NaN included, has no end of dashes.
  return Number.isFinite(count) ? count : Infinity;
}
