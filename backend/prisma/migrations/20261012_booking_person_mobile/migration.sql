ALTER TABLE app.bookings
  ADD COLUMN booking_person_mobile TEXT;

ALTER TABLE app.bookings
  ADD CONSTRAINT bookings_booking_person_mobile_format
  CHECK (booking_person_mobile IS NULL OR booking_person_mobile ~ '^\+?[1-9][0-9]{9,14}$');
