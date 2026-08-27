-- Adding parameters with defaults in 0019 and 0027 CREATED new functions rather
-- than replacing the old ones, leaving three overloads of kg_checkin_by_tag.
-- Every parameter has a default, so a call naming 5 or 6 arguments matched all
-- three candidates and Postgres refused it outright (42725, "function is not
-- unique") — every kiosk check-in would have failed. Worse, the surviving
-- 6-argument body from 0019 has no duplicate-scan detection at all, so reaching
-- it would silently toggle a second scan into a departure.
--
-- Rule for next time: when adding a parameter to an existing RPC, drop the old
-- signature in the same migration. `create or replace` only replaces an exact
-- signature match.
drop function if exists kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text);
drop function if exists kg_checkin_by_tag(uuid, text, text, kg_checkin_method, text, uuid);
