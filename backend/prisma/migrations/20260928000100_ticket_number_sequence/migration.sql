-- Race-free ticket numbers (INC-10001, INC-10002, ...). Read via nextval() in the app.
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START WITH 10001 INCREMENT BY 1;
