-- A plate used to be unique across the whole platform. That meant a car registered at one property (or by one
-- organisation) could not be registered, or even auto-registered when it arrived as a visitor, at any other property:
-- the visitor check-in failed half way after the visitor had already been marked as inside.
-- Now a plate is unique per property, stored upper-case without spaces or dashes ("KCA 123A" and "kca-123a" are one car).
-- Safe to run more than once.

ALTER TABLE registered_vehicles DROP CONSTRAINT IF EXISTS registered_vehicles_plate_number_unique;

-- normalise existing plates, except where that would collide with another vehicle at the same property
UPDATE registered_vehicles v
   SET plate_number = REPLACE(REPLACE(UPPER(v.plate_number), ' ', ''), '-', '')
 WHERE v.plate_number <> REPLACE(REPLACE(UPPER(v.plate_number), ' ', ''), '-', '')
   AND NOT EXISTS (
         SELECT 1 FROM registered_vehicles o
          WHERE o.property_id = v.property_id AND o.id <> v.id
            AND o.plate_number = REPLACE(REPLACE(UPPER(v.plate_number), ' ', ''), '-', ''));

CREATE UNIQUE INDEX IF NOT EXISTS registered_vehicles_property_plate_uidx ON registered_vehicles (property_id, plate_number);
