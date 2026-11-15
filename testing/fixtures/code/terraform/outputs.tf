output "summary" {
  description = "The summary of the words."
  value       = terraform_data.summary.output
}

output "total" {
  description = "How many words there are."
  value       = local.total
}
