/**
 * How long a figure's shapes can be, at most, in their own units, and so how many dashes a dash
 * pattern draws along them. A browser draws up to a million dashes on one path, each as much work
 * as a shape, so a figure is charged for each. The lengths are upper bounds: a curve is no longer
 * than the polygon of its control points, and an arc no longer than the whole ellipse it's part of.
 * Dash counts don't change with scale, so no transform matters.
 */

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
  const scale = reach > 1 ? Math.sqrt(reach) : 1;
  return 2 * Math.PI * Math.max(a, b) * scale;
}

/**
 * Follows a path's commands, as SVG's grammar reads them, adding up at most how long it is: each
 * line, each curve's control polygon (a smooth curve's reflected control point included), each
 * arc's whole ellipse, and each close back to where its subpath began.
 */
export class Pen {
  /** At most how long the path is so far. */
  length = 0;
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
    const ox = relative ? this.x : 0;
    const oy = relative ? this.y : 0;
    const at = (index: number): number => values[index] ?? 0;
    let cubic: [number, number] | undefined;
    let quadratic: [number, number] | undefined;
    switch (lower) {
      case 'm':
        if (first) {
          this.x = ox + at(0);
          this.y = oy + at(1);
          this.startX = this.x;
          this.startY = this.y;
        } else {
          this.to(ox + at(0), oy + at(1));
        }
        break;
      case 'l':
        this.to(ox + at(0), oy + at(1));
        break;
      case 'h':
        this.to(ox + at(0), this.y);
        break;
      case 'v':
        this.to(this.x, oy + at(0));
        break;
      case 'c':
        cubic = [ox + at(2), oy + at(3)];
        this.via([ox + at(0), oy + at(1), ...cubic, ox + at(4), oy + at(5)]);
        break;
      case 's':
        cubic = [ox + at(0), oy + at(1)];
        this.via([...this.reflect(this.cubic), ...cubic, ox + at(2), oy + at(3)]);
        break;
      case 'q':
        quadratic = [ox + at(0), oy + at(1)];
        this.via([...quadratic, ox + at(2), oy + at(3)]);
        break;
      case 't':
        quadratic = this.reflect(this.quadratic);
        this.via([...quadratic, ox + at(0), oy + at(1)]);
        break;
      case 'a': {
        const x = ox + at(5);
        const y = oy + at(6);
        this.length += arcLength(this.x, this.y, at(0), at(1), at(2), x, y);
        this.x = x;
        this.y = y;
        break;
      }
      case 'z':
        this.to(this.startX, this.startY);
        break;
    }
    this.cubic = cubic;
    this.quadratic = quadratic;
  }

  /** A line to (x, y). */
  private to(x: number, y: number): void {
    this.length += distance(this.x, this.y, x, y);
    this.x = x;
    this.y = y;
  }

  /** A curve's control polygon: lines through `points`, pairs of numbers, the last its end. */
  private via(points: readonly number[]): void {
    for (let i = 0; i + 1 < points.length; i += 2) this.to(points[i]!, points[i + 1]!);
  }

  /** `control` reflected through the current point, or the current point when there's none. */
  private reflect(control: [number, number] | undefined): [number, number] {
    return control ? [2 * this.x - control[0], 2 * this.y - control[1]] : [this.x, this.y];
  }
}

/** The length of the lines through `values`, pairs of numbers, closed when `closed`. */
export function polylineLength(values: readonly number[], closed: boolean): number {
  let length = 0;
  for (let i = 2; i + 1 < values.length; i += 2) {
    length += distance(values[i - 2]!, values[i - 1]!, values[i]!, values[i + 1]!);
  }
  if (closed && values.length >= 4) {
    length += distance(values.at(-2)!, values.at(-1)!, values[0]!, values[1]!);
  }
  return length;
}

/**
 * At most how many dashes `pattern`, the numbers of a dash array, draws along `length`. A pattern
 * of an odd count of numbers is repeated to make an even one, so either way it draws half as many
 * dashes as it has numbers in each run of their sum; one more of each for where the pattern starts.
 * A pattern of zeros draws a solid line.
 */
export function dashCount(pattern: readonly number[], length: number): number {
  const period = pattern.reduce((sum, value) => sum + value, 0);
  if (period <= 0) return 0;
  return Math.ceil((length * pattern.length) / (2 * period)) + pattern.length;
}
