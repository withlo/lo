use std::collections::HashMap;

/// Counts the words in `text`: runs of characters between whitespace.
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// Counts how often each word comes up.
#[derive(Default)]
pub struct Tally {
    counts: HashMap<String, usize>,
}

impl Tally {
    /// Adds one more sighting of `word`, and returns how many have been seen.
    pub fn add(&mut self, word: &str) -> usize {
        let seen = self.counts.entry(word.to_string()).or_insert(0);
        *seen += 1;
        *seen
    }

    /// The word seen most often, if any.
    pub fn top(&self) -> Option<&str> {
        self.counts
            .iter()
            .max_by_key(|(_, seen)| **seen)
            .map(|(word, _)| word.as_str())
    }
}
