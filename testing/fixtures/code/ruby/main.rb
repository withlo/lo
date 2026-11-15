# frozen_string_literal: true

require_relative 'lib/report'

text = 'the quick brown fox jumps over the lazy dog'
puts Report.summarize(text)
puts "#{Words.count_words(text)} words in all"
