package sample

/** Counts the words in [text]: runs of characters between whitespace. */
fun countWords(text: String): Int = text.split(Regex("\\s+")).count { it.isNotEmpty() }

/** Counts how often each word comes up. */
class Tally {
    private val counts = mutableMapOf<String, Int>()

    /** Adds one more sighting of [word], and returns how many have been seen. */
    fun add(word: String): Int {
        val seen = (counts[word] ?: 0) + 1
        counts[word] = seen
        return seen
    }

    /** The word seen most often, or null before any. */
    fun top(): String? = counts.maxByOrNull { it.value }?.key
}
