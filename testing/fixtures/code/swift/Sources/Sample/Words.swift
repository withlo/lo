/// Counts the words in `text`: runs of characters between whitespace.
func countWords(_ text: String) -> Int {
    text.split(whereSeparator: { $0.isWhitespace }).count
}

/// Counts how often each word comes up.
struct Tally {
    private var counts: [String: Int] = [:]

    /// Adds one more sighting of `word`, and returns how many have been seen.
    @discardableResult
    mutating func add(_ word: String) -> Int {
        let seen = (counts[word] ?? 0) + 1
        counts[word] = seen
        return seen
    }

    /// The word seen most often, or nil before any.
    func top() -> String? {
        counts.max { $0.value < $1.value }?.key
    }
}
