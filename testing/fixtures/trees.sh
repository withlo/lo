# shellcheck shell=bash
# Both sides of three pull requests in GitHub's rozed-dev/e2e test repository, whose files
# GitHub's API lists in testing/fixtures/github/rest_pull_files_e2e, each with its patch:
#
#   e6_tree, e9_tree, e12_tree <base | head> <folder>
#
# Each writes one side of its pull request into <folder>, replacing what's there. Nothing here
# reads the network, and every file comes out byte for byte the same each time, on any machine,
# so a tree can be written and looked at anywhere:
#
#   (. testing/fixtures/trees.sh && e9_tree head "$(mktemp -d)")
#
# E9's 1.2 MB file comes from awk with a Park-Miller generator, x * 16807 mod 2^31 - 1, which
# stays exact in awk's doubles, so every awk makes the same file.

# Writes stdin to <path>, making its folder.
put() {
  mkdir -p "$(dirname "$1")"
  cat >"$1"
}

# Fails unless <side> is base or head.
check_side() {
  case $1 in
    base | head) ;;
    *)
      echo "trees.sh: a side is base or head, not $1" >&2
      return 1
      ;;
  esac
}

# --- E6: code, in four languages ----------------------------------------------------------------

# Rust, TypeScript, Python and Go. The head side:
# - adds e6/rust/src/render/parse.rs, whose `parse` collides with e6/rust/src/parse.rs's;
# - imports serde in lib.rs, which Cargo.toml never declares, so it's never installed;
# - renames `summarize` to `describe` in lib.rs, so the left side's `summarize` still resolves;
# - calls functions in files it changes (render/parse.rs, user.ts, util.py, util.go) and in files
#   it doesn't (parse.rs's `count`, names.ts's `initials`).
e6_tree() {
  local side=$1 dir=${2:?}/e6
  check_side "$side" || return 1
  rm -rf "$dir"

  put "$dir/rust/Cargo.toml" <<'EOF'
[package]
name = "e6"
version = "0.1.0"
edition = "2021"

# src/lib.rs uses serde, which is never declared, so it's never installed.
[dependencies]
EOF

  put "$dir/rust/src/parse.rs" <<'EOF'
//! Splits text into words.

/// Splits `text` into words, on whitespace.
pub fn parse(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

/// Counts the words in `text`.
pub fn count(text: &str) -> usize {
    parse(text).len()
}
EOF

  if [[ $side == base ]]; then
    put "$dir/rust/src/lib.rs" <<'EOF'
//! Fixture E6: Rust code for Lo's code navigation.

pub mod parse;

/// Summarises `text` by its word count.
pub fn summarize(text: &str) -> String {
    format!("{} words", parse::count(text))
}

/// Summarises a document's body.
pub fn run(body: &str) -> String {
    summarize(body)
}
EOF
  else
    put "$dir/rust/src/lib.rs" <<'EOF'
//! Fixture E6: Rust code for Lo's code navigation.

use serde::Deserialize;

pub mod parse;
pub mod render {
    pub mod parse;
}

/// A document to describe. serde is never installed, so `Deserialize` never resolves.
#[derive(Deserialize)]
pub struct Document {
    pub title: String,
    pub body: String,
}

/// Describes `text` by its word count. It was `summarize`.
pub fn describe(text: &str) -> String {
    format!("{} words", parse::count(text))
}

/// Describes a document: its title as HTML, then its body.
pub fn run(doc: &Document) -> String {
    let title = render::parse::parse(&doc.title);
    let words = parse::parse(&doc.body);
    format!("{title} {} (first word: {:?})", describe(&doc.body), words.first())
}
EOF
    put "$dir/rust/src/render/parse.rs" <<'EOF'
//! Renders a title as HTML. Its `parse` shares a name with `crate::parse::parse`.

/// Parses `title` into an HTML heading, escaping angle brackets.
pub fn parse(title: &str) -> String {
    let escaped = title.replace('<', "&lt;").replace('>', "&gt;");
    format!("<h1>{escaped}</h1>")
}
EOF
  fi

  put "$dir/ts/src/names.ts" <<'EOF'
// Fixture E6: name helpers the pull request calls but doesn't change.

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
EOF

  if [[ $side == base ]]; then
    put "$dir/ts/src/user.ts" <<'EOF'
import { capitalize } from "./names";

export interface User {
  first: string;
  last: string;
}

export function fullName(user: User): string {
  return `${capitalize(user.first)} ${capitalize(user.last)}`;
}
EOF
    put "$dir/ts/src/index.ts" <<'EOF'
import { fullName, type User } from "./user";

export function greet(user: User): string {
  return `Hello, ${fullName(user)}!`;
}
EOF
  else
    put "$dir/ts/src/user.ts" <<'EOF'
import { capitalize } from "./names";

export interface User {
  first: string;
  last: string;
  admin?: boolean;
}

export function fullName(user: User): string {
  return `${capitalize(user.first)} ${capitalize(user.last)}`;
}

export function isAdmin(user: User): boolean {
  return user.admin === true;
}
EOF
    put "$dir/ts/src/index.ts" <<'EOF'
import { initials } from "./names";
import { fullName, isAdmin, type User } from "./user";

export function greet(user: User): string {
  const badge = isAdmin(user) ? " (admin)" : "";
  return `Hello, ${fullName(user)}${badge}!`;
}

export function monogram(user: User): string {
  return initials(fullName(user));
}
EOF
  fi

  if [[ $side == base ]]; then
    put "$dir/py/util.py" <<'EOF'
"""Fixture E6: Python helpers."""


def slugify(text):
    return "-".join(text.lower().split())
EOF
    put "$dir/py/app.py" <<'EOF'
"""Fixture E6: a Python app that uses util."""

from util import slugify


def page_path(title):
    return "/pages/" + slugify(title)
EOF
  else
    put "$dir/py/util.py" <<'EOF'
"""Fixture E6: Python helpers."""


def slugify(text):
    return "-".join(text.lower().split())


def truncate(text, limit):
    return text if len(text) <= limit else text[: limit - 3] + "..."
EOF
    put "$dir/py/app.py" <<'EOF'
"""Fixture E6: a Python app that uses util."""

from util import slugify, truncate


def page_path(title):
    return "/pages/" + slugify(truncate(title, 40))


def page_link(title):
    return f'<a href="{page_path(title)}">{title}</a>'
EOF
  fi

  put "$dir/go/go.mod" <<'EOF'
module example.com/e6

go 1.21
EOF

  if [[ $side == base ]]; then
    put "$dir/go/main.go" <<'EOF'
// Fixture E6: a Go program.
package main

import "fmt"

func main() {
	fmt.Println(greeting("world"))
}

func greeting(name string) string {
	return "Hello, " + name
}
EOF
  else
    put "$dir/go/main.go" <<'EOF'
// Fixture E6: a Go program.
package main

import "fmt"

func main() {
	fmt.Println(greeting(shout("world")))
}

func greeting(name string) string {
	return "Hello, " + name
}
EOF
    put "$dir/go/util.go" <<'EOF'
package main

import "strings"

// shout upper-cases name and adds an exclamation mark.
func shout(name string) string {
	return strings.ToUpper(name) + "!"
}
EOF
  fi
}

# --- E9: moves and syntax -----------------------------------------------------------------------

# Moves, syntax-aware cases and fallbacks:
# - fullName moves from api/user.ts into the Names class in api/names.ts: re-indented, with its
#   return line edited. user.ts also loses legacyName outright, for a thread on a line only the
#   old side has;
# - checksum moves up lib.rs, unchanged;
# - two lines move down short.py, too few to count as a move;
# - syntax/rename.rs renames a variable, syntax/args.ts reorders arguments, syntax/wrap.py wraps
#   a block in a new if, and syntax/config.json reorders keys;
# - broken.ts gains a parse error, and large.ts is 1.2 MB on both sides.
e9_tree() {
  local side=$1 dir=${2:?}/e9
  check_side "$side" || return 1
  rm -rf "$dir"

  if [[ $side == base ]]; then
    put "$dir/api/user.ts" <<'EOF'
// Fixture E9: fullName moves from here into the Names class in names.ts.

export interface User {
  first: string;
  middle?: string;
  last: string;
  email: string;
}

export function emailDomain(user: User): string {
  return user.email.split("@")[1] ?? "";
}

export function fullName(user: User): string {
  const first = user.first.trim();
  const middle = user.middle?.trim();
  const last = user.last.trim();
  return [first, middle, last].filter(Boolean).join(" ");
}

export function isValid(user: User): boolean {
  return user.first.length > 0 && user.last.length > 0;
}

export function legacyName(user: User): string {
  return `${user.last.toUpperCase()}, ${user.first}`;
}
EOF
    put "$dir/api/names.ts" <<'EOF'
// Fixture E9: fullName moves here from user.ts.

import type { User } from "./user";

export class Names {
  constructor(private readonly users: User[]) {}

  sorted(): string[] {
    return this.users.map((user) => user.last).sort();
  }
}
EOF
  else
    put "$dir/api/user.ts" <<'EOF'
// Fixture E9: fullName moves from here into the Names class in names.ts.

export interface User {
  first: string;
  middle?: string;
  last: string;
  email: string;
}

export function emailDomain(user: User): string {
  return user.email.split("@")[1] ?? "";
}

export function isValid(user: User): boolean {
  return user.first.length > 0 && user.last.length > 0;
}
EOF
    put "$dir/api/names.ts" <<'EOF'
// Fixture E9: fullName moves here from user.ts.

import type { User } from "./user";

export class Names {
  constructor(private readonly users: User[]) {}

  fullName(user: User): string {
    const first = user.first.trim();
    const middle = user.middle?.trim();
    const last = user.last.trim();
    return [first, middle, last].filter((name) => name).join(" ");
  }

  sorted(): string[] {
    return this.users.map((user) => user.last).sort();
  }
}
EOF
  fi

  # The lines that stay put outnumber checksum's, so a line diff moves checksum, not them.
  if [[ $side == base ]]; then
    put "$dir/lib.rs" <<'EOF'
//! Fixture E9: `checksum` moves up this file, unchanged.

pub fn parse_header(line: &str) -> Option<(&str, &str)> {
    let (name, value) = line.split_once(':')?;
    Some((name.trim(), value.trim()))
}

pub fn parse_headers(text: &str) -> Vec<(&str, &str)> {
    text.lines().filter_map(parse_header).collect()
}

pub fn header_names(text: &str) -> Vec<&str> {
    parse_headers(text).into_iter().map(|(name, _)| name).collect()
}

pub fn has_header(text: &str, wanted: &str) -> bool {
    header_names(text)
        .iter()
        .any(|name| name.eq_ignore_ascii_case(wanted))
}

pub fn checksum(bytes: &[u8]) -> u32 {
    let mut sum: u32 = 0;
    for byte in bytes {
        sum = sum.wrapping_mul(31).wrapping_add(u32::from(*byte));
    }
    sum
}
EOF
  else
    put "$dir/lib.rs" <<'EOF'
//! Fixture E9: `checksum` moves up this file, unchanged.

pub fn parse_header(line: &str) -> Option<(&str, &str)> {
    let (name, value) = line.split_once(':')?;
    Some((name.trim(), value.trim()))
}

pub fn checksum(bytes: &[u8]) -> u32 {
    let mut sum: u32 = 0;
    for byte in bytes {
        sum = sum.wrapping_mul(31).wrapping_add(u32::from(*byte));
    }
    sum
}

pub fn parse_headers(text: &str) -> Vec<(&str, &str)> {
    text.lines().filter_map(parse_header).collect()
}

pub fn header_names(text: &str) -> Vec<&str> {
    parse_headers(text).into_iter().map(|(name, _)| name).collect()
}

pub fn has_header(text: &str, wanted: &str) -> bool {
    header_names(text)
        .iter()
        .any(|name| name.eq_ignore_ascii_case(wanted))
}
EOF
  fi

  # describe() is longer than the two lines, so a line diff moves the two lines, not it.
  if [[ $side == base ]]; then
    put "$dir/short.py" <<'EOF'
"""Fixture E9: two lines move below describe(), too few to count as a move."""

TIMEOUT_SECONDS = 30
RETRY_LIMIT = 3


def describe():
    parts = [
        f"timeout {TIMEOUT_SECONDS}s",
        f"{RETRY_LIMIT} retries",
    ]
    return ", ".join(parts)


def main():
    print(describe())
EOF
  else
    put "$dir/short.py" <<'EOF'
"""Fixture E9: two lines move below describe(), too few to count as a move."""


def describe():
    parts = [
        f"timeout {TIMEOUT_SECONDS}s",
        f"{RETRY_LIMIT} retries",
    ]
    return ", ".join(parts)


TIMEOUT_SECONDS = 30
RETRY_LIMIT = 3


def main():
    print(describe())
EOF
  fi

  if [[ $side == base ]]; then
    put "$dir/syntax/rename.rs" <<'EOF'
//! Fixture E9: `total` is renamed to `sum`, so only the name changes.

pub fn average(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let total: f64 = values.iter().sum();
    total / values.len() as f64
}
EOF
    put "$dir/syntax/args.ts" <<'EOF'
// Fixture E9: clamp's arguments are reordered, in its signature and at its call.

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function percent(done: number, total: number): number {
  return clamp((done / total) * 100, 0, 100);
}
EOF
    put "$dir/syntax/wrap.py" <<'EOF'
"""Fixture E9: a block is wrapped in a new if, so only the if is new."""


def save(path, data, log):
    tmp = path + ".tmp"
    with open(tmp, "wb") as out:
        out.write(data)
    log.append(f"saved {len(data)} bytes to {path}")
    return tmp
EOF
    put "$dir/syntax/config.json" <<'EOF'
{
  "name": "e9",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "node --test"
  },
  "license": "MIT"
}
EOF
    put "$dir/broken.ts" <<'EOF'
// Fixture E9: the new version has a parse error, so the syntax-aware view falls back.

export function total(items: number[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item;
  }
  return sum;
}
EOF
  else
    put "$dir/syntax/rename.rs" <<'EOF'
//! Fixture E9: `total` is renamed to `sum`, so only the name changes.

pub fn average(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let sum: f64 = values.iter().sum();
    sum / values.len() as f64
}
EOF
    put "$dir/syntax/args.ts" <<'EOF'
// Fixture E9: clamp's arguments are reordered, in its signature and at its call.

export function clamp(min: number, max: number, value: number): number {
  return Math.min(Math.max(value, min), max);
}

export function percent(done: number, total: number): number {
  return clamp(0, 100, (done / total) * 100);
}
EOF
    put "$dir/syntax/wrap.py" <<'EOF'
"""Fixture E9: a block is wrapped in a new if, so only the if is new."""


def save(path, data, log):
    tmp = path + ".tmp"
    if data:
        with open(tmp, "wb") as out:
            out.write(data)
        log.append(f"saved {len(data)} bytes to {path}")
    return tmp
EOF
    put "$dir/syntax/config.json" <<'EOF'
{
  "version": "1.0.0",
  "name": "e9",
  "private": true,
  "license": "MIT",
  "scripts": {
    "test": "node --test",
    "build": "tsc"
  }
}
EOF
    put "$dir/broken.ts" <<'EOF'
// Fixture E9: the new version has a parse error, so the syntax-aware view falls back.

export function total(items: number[]): number {
  let sum = 0;
  for (const item of items {
    sum += item * 2;
  }
  return sum;
}
EOF
  fi

  # 20,000 rows of about 62 bytes; the head side changes three of them.
  awk -v side="$side" 'BEGIN {
    state = 9
    print "// Fixture E9: over 1 MB, so the syntax-aware view falls back to the line diff."
    print "export const ROWS: Array<[number, string]> = ["
    for (i = 1; i <= 20000; i++) {
      words = ""
      for (w = 1; w <= 4; w++) {
        state = (state * 16807) % 2147483647
        words = words sprintf(" %08x", state)
      }
      if (side == "head" && (i == 5000 || i == 12000 || i == 18000)) words = words " changed"
      printf "  [%d, \"row %06d:%s\"],\n", i, i, words
    }
    print "];"
  }' >"$dir/large.ts"
}

# --- E12: languages from bundled extensions ----------------------------------------------------

# One file each in Swift, Kotlin, Terraform, Ruby, Java, C#, PHP, Elixir, TOML, HTML, a Dockerfile
# and a Makefile, each changed by the head side. None is part of a project a language server would
# build: no Package.swift, Gradle, mix.exs or the like.
e12_tree() {
  local side=$1 dir=${2:?}/e12
  check_side "$side" || return 1
  rm -rf "$dir"

  if [[ $side == base ]]; then
    put "$dir/swift/Greeter.swift" <<'EOF'
// Fixture E12: Swift.
struct Greeter {
    let name: String

    func greet() -> String {
        "Hello, \(name)!"
    }
}
EOF
    put "$dir/kotlin/Greeter.kt" <<'EOF'
// Fixture E12: Kotlin.
class Greeter(private val name: String) {
    fun greet(): String = "Hello, $name!"
}
EOF
    put "$dir/terraform/main.tf" <<'EOF'
# Fixture E12: Terraform, with no providers or resources.
variable "name" {
  type    = string
  default = "world"
}

output "greeting" {
  value = "Hello, ${var.name}!"
}
EOF
    put "$dir/ruby/greeter.rb" <<'EOF'
# Fixture E12: Ruby.
class Greeter
  def initialize(name)
    @name = name
  end

  def greet
    "Hello, #{@name}!"
  end
end
EOF
    put "$dir/java/Greeter.java" <<'EOF'
// Fixture E12: Java.
public final class Greeter {
    private final String name;

    public Greeter(String name) {
        this.name = name;
    }

    public String greet() {
        return "Hello, " + name + "!";
    }
}
EOF
    put "$dir/csharp/Greeter.cs" <<'EOF'
// Fixture E12: C#.
namespace E12;

public sealed class Greeter(string name)
{
    public string Greet() => $"Hello, {name}!";
}
EOF
    put "$dir/php/greeter.php" <<'EOF'
<?php
// Fixture E12: PHP.

final class Greeter
{
    public function __construct(private string $name)
    {
    }

    public function greet(): string
    {
        return "Hello, {$this->name}!";
    }
}
EOF
    put "$dir/elixir/greeter.ex" <<'EOF'
# Fixture E12: Elixir.
defmodule Greeter do
  def greet(name) do
    "Hello, #{name}!"
  end
end
EOF
    put "$dir/toml/settings.toml" <<'EOF'
# Fixture E12: TOML.
[greeting]
name = "world"
punctuation = "!"
EOF
    put "$dir/html/index.html" <<'EOF'
<!doctype html>
<!-- Fixture E12: HTML. -->
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Greeting</title>
  </head>
  <body>
    <h1>Hello, world!</h1>
  </body>
</html>
EOF
    put "$dir/docker/Dockerfile" <<'EOF'
# Fixture E12: a Dockerfile.
FROM alpine:3.20
WORKDIR /app
COPY greeting.txt .
CMD ["cat", "greeting.txt"]
EOF
    mkdir -p "$dir/make"
    printf '%s\n' '# Fixture E12: a Makefile.' 'NAME ?= world' '' 'greet:' \
      $'\t@echo "Hello, $(NAME)!"' '' '.PHONY: greet' >"$dir/make/Makefile"
  else
    put "$dir/swift/Greeter.swift" <<'EOF'
// Fixture E12: Swift.
struct Greeter {
    let name: String
    var excited = false

    func greet() -> String {
        excited ? "Hello, \(name)!!" : "Hello, \(name)!"
    }
}
EOF
    put "$dir/kotlin/Greeter.kt" <<'EOF'
// Fixture E12: Kotlin.
class Greeter(private val name: String, private val excited: Boolean = false) {
    fun greet(): String = if (excited) "Hello, $name!!" else "Hello, $name!"
}
EOF
    put "$dir/terraform/main.tf" <<'EOF'
# Fixture E12: Terraform, with no providers or resources.
variable "name" {
  type    = string
  default = "world"
}

variable "excited" {
  type    = bool
  default = false
}

output "greeting" {
  value = var.excited ? "Hello, ${var.name}!!" : "Hello, ${var.name}!"
}
EOF
    put "$dir/ruby/greeter.rb" <<'EOF'
# Fixture E12: Ruby.
class Greeter
  def initialize(name, excited: false)
    @name = name
    @excited = excited
  end

  def greet
    @excited ? "Hello, #{@name}!!" : "Hello, #{@name}!"
  end
end
EOF
    put "$dir/java/Greeter.java" <<'EOF'
// Fixture E12: Java.
public final class Greeter {
    private final String name;
    private final boolean excited;

    public Greeter(String name, boolean excited) {
        this.name = name;
        this.excited = excited;
    }

    public String greet() {
        return "Hello, " + name + (excited ? "!!" : "!");
    }
}
EOF
    put "$dir/csharp/Greeter.cs" <<'EOF'
// Fixture E12: C#.
namespace E12;

public sealed class Greeter(string name, bool excited = false)
{
    public string Greet() => excited ? $"Hello, {name}!!" : $"Hello, {name}!";
}
EOF
    put "$dir/php/greeter.php" <<'EOF'
<?php
// Fixture E12: PHP.

final class Greeter
{
    public function __construct(private string $name, private bool $excited = false)
    {
    }

    public function greet(): string
    {
        return "Hello, {$this->name}" . ($this->excited ? "!!" : "!");
    }
}
EOF
    put "$dir/elixir/greeter.ex" <<'EOF'
# Fixture E12: Elixir.
defmodule Greeter do
  def greet(name, excited \\ false) do
    if excited, do: "Hello, #{name}!!", else: "Hello, #{name}!"
  end
end
EOF
    put "$dir/toml/settings.toml" <<'EOF'
# Fixture E12: TOML.
[greeting]
name = "world"
punctuation = "!!"
excited = true
EOF
    put "$dir/html/index.html" <<'EOF'
<!doctype html>
<!-- Fixture E12: HTML. -->
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Greeting</title>
  </head>
  <body>
    <h1>Hello, world!!</h1>
    <p>Excited, too.</p>
  </body>
</html>
EOF
    put "$dir/docker/Dockerfile" <<'EOF'
# Fixture E12: a Dockerfile.
FROM alpine:3.21
RUN adduser -D app
USER app
WORKDIR /app
COPY greeting.txt .
CMD ["cat", "greeting.txt"]
EOF
    mkdir -p "$dir/make"
    printf '%s\n' '# Fixture E12: a Makefile.' 'NAME ?= world' '' 'greet:' \
      $'\t@echo "Hello, $(NAME)!"' '' 'shout:' $'\t@echo "HELLO, $(NAME)!!"' '' \
      '.PHONY: greet shout' >"$dir/make/Makefile"
  fi
}
