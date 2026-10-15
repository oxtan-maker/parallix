-- Legacy decisions deliberately retain NULL: their reviewed head is unknown.
ALTER TABLE mission_review_rounds ADD COLUMN decided_revision TEXT;
