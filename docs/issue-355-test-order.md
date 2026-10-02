# Canonical test order

1. lock RED specification;
2. run focused positive and negative fixtures;
3. run pre-existing package-response checks;
4. build twice with Nix from a clean checkout;
5. compare exact output identity;
6. consume the exact output in the edits shadow adapter;
7. merge only the exact tested head.
