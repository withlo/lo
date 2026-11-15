# A summary of the words: how many there are, and the line they make.
resource "terraform_data" "summary" {
  input = "${local.total} words: ${local.line}"
}
