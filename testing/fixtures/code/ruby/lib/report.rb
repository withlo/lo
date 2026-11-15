# frozen_string_literal: true

require_relative 'words'

# Summaries of a text.
module Report
  # A summary of +text+: how many words it has, and the one that comes up most.
  def self.summarize(text)
    tally = Words::Tally.new
    text.split.each { |word| tally.add(word.downcase) }
    total = Words.count_words(text)
    "#{total} words, mostly \"#{tally.top}\""
  end
end
