package geometry

import "fmt"

// KMonadConstructor resolves any accepted KMonad spelling to the keycode
// constructor that identifies the key. Matching layout source keys and
// manager-attested scan keys by this value avoids treating aliases such as
// lsgt/102d or cmp/cmps as different keys.
func KMonadConstructor(token string) (string, bool) {
	constructor, found := kmonadKeycodeTokens[token]
	return constructor, found
}

// NormalizeKMonadTokens converts a KMonad token list into a set of keycode
// constructors. It rejects unknown tokens rather than silently dropping scan
// evidence or catalog data.
func NormalizeKMonadTokens(tokens []string) (map[string]bool, error) {
	constructors := make(map[string]bool, len(tokens))
	for _, token := range tokens {
		constructor, found := KMonadConstructor(token)
		if !found {
			return nil, fmt.Errorf("unknown KMonad token %q", token)
		}
		constructors[constructor] = true
	}
	return constructors, nil
}
