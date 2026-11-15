locals {
  # How many words there are.
  total = length(var.words)

  # The words, joined into one line.
  line = join(" ", var.words)
}
