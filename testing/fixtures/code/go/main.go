package main

import "fmt"

func main() {
	text := "the quick brown fox jumps over the lazy dog"
	fmt.Println(Summarize(text))
	fmt.Printf("%d words in all\n", CountWords(text))
}
