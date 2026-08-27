-- 0050 — A pin on the map, so a family can actually find the place.
--
-- Address lines in Algeria are frequently not routable: "Cité 20 Août, Rue des
-- Frères Khaled" is how people describe where they live, not something a
-- navigation app can resolve. A parent on their way to a first visit, or an
-- ambulance, needs coordinates. The address stays — it is what goes on the
-- facture and the décret 19-253 register — and the pin is what gets you there.
--
-- Two plain numerics rather than PostGIS: nothing here does geometry, and a
-- crèche has exactly one location.

alter table kg_tenants
  add column if not exists latitude  numeric(9, 6),
  add column if not exists longitude numeric(9, 6);

-- A pin is either complete or absent — half a coordinate points at the Gulf of
-- Guinea. The range check catches a longitude typed into the latitude field,
-- which is the mistake people actually make.
alter table kg_tenants drop constraint if exists kg_tenants_location_ck;
alter table kg_tenants add constraint kg_tenants_location_ck check (
  (latitude is null and longitude is null)
  or (latitude between -90 and 90 and longitude between -180 and 180)
);

comment on column kg_tenants.latitude  is 'Map pin, WGS84. Set together with longitude or not at all.';
comment on column kg_tenants.longitude is 'Map pin, WGS84. Set together with latitude or not at all.';
