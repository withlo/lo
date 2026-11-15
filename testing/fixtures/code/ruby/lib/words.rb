# frozen_string_literal: true

# Counting words.
module Words
  # Counts the words in +text+: runs of characters between whitespace.
  def self.count_words(text)
    text.split.size
  end

  # Counts how often each word comes up.
  class Tally
    def initialize
      @counts = Hash.new(0)
    end

    # Adds one more sighting of +word+, and returns how many have been seen.
    def add(word)
      @counts[word] += 1
    end

    # The word seen most often, or nil before any.
    def top
      @counts.max_by { |_word, seen| seen }&.first
    end
  end
end
