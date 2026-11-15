defmodule Sample.Words do
  @moduledoc "Counting words."

  @doc "Counts the words in `text`: runs of characters between whitespace."
  @spec count_words(String.t()) :: non_neg_integer()
  def count_words(text) do
    text |> String.split() |> length()
  end

  @doc "Counts how often each word comes up, as a map from word to count."
  @spec tally([String.t()]) :: %{String.t() => pos_integer()}
  def tally(words) do
    Enum.frequencies(words)
  end

  @doc "The word seen most often in `tally`, or nil when it is empty."
  @spec top(%{String.t() => pos_integer()}) :: String.t() | nil
  def top(tally) do
    case Enum.sort_by(tally, fn {_word, seen} -> -seen end) do
      [] -> nil
      [{word, _seen} | _rest] -> word
    end
  end
end
