# Edits consumer boundary

`edits` consumes only the immutable output of this package. It must not inspect the `ops` repository HEAD or package internals at runtime.

The catalog is a non-authority projection of already accepted package obligations and package-owned finite operations. It cannot execute, claim, retry, cancel, emit canonical results, or alter accepted meaning.
