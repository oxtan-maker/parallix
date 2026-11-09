<existing_owner_first>
This is maintenance of an existing codebase. Prefer modifying the current implementation over creating a new one.

BEFORE THE FIRST CODE EDIT:
1. Locate the existing owner of the relevant behavior. Use Graphify when available, then inspect source code, call sites, and existing tests. Search by behavior as well as symbol names.
2. Read the candidate implementations. Identify the owning file and symbol, its callers, and the intended edit. State these briefly before proceeding.
3. If no suitable owner exists, state what was searched and why a new implementation is necessary.

DO NOT create a parallel implementation, handler, store, adapter, helper, or test suite for a contract already owned by existing code.

Extend or refactor the existing owner. When replacing an implementation, migrate its callers and remove the superseded path.

BEFORE COMPLETION:
Inspect the diff for duplicate ownership and verify that the real production call path uses the changed implementation. Explain any newly introduced owner.
</existing_owner_first>