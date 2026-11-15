defmodule Sample.Report do
  @moduledoc "Summaries of a text."

  alias Sample.Words

  @doc "A summary of `text`: how many words it has, and the one that comes up most."
  @spec summarize(String.t()) :: String.t()
  def summarize(text) do
    top = text |> String.split() |> Enum.map(&String.downcase/1) |> Words.tally() |> Words.top()
    total = Words.count_words(text)
    ~s(#{total} words, mostly "#{top}")
  end
end
