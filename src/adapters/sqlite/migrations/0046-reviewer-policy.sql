-- Typed reviewer identities, availability and required approval count for one review round.
ALTER TABLE mission_review_rounds ADD COLUMN reviewer_policy TEXT;
