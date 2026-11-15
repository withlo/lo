package main

import "strings"

// CountWords counts the words in text: runs of characters between whitespace.
func CountWords(text string) int {
	return len(strings.Fields(text))
}

// Tally counts how often each word comes up.
type Tally struct {
	counts map[string]int
}

// NewTally returns a Tally with nothing counted.
func NewTally() *Tally {
	return &Tally{counts: map[string]int{}}
}

// Add adds one more sighting of word, and returns how many have been seen.
func (t *Tally) Add(word string) int {
	t.counts[word]++
	return t.counts[word]
}

// Top returns the word seen most often, or "" before any.
func (t *Tally) Top() string {
	best := ""
	for word, seen := range t.counts {
		if best == "" || seen > t.counts[best] {
			best = word
		}
	}
	return best
}
