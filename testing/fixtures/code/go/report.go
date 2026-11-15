package main

import (
	"fmt"
	"strings"
)

// Summarize summarizes text: how many words it has, and the one that comes up most.
func Summarize(text string) string {
	tally := NewTally()
	for _, word := range strings.Fields(text) {
		tally.Add(strings.ToLower(word))
	}
	total := CountWords(text)
	return fmt.Sprintf("%d words, mostly %q", total, tally.Top())
}
