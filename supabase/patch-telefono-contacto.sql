-- Teléfono de contacto preferido (si difiere del WhatsApp desde el que escribe).
-- Ejecutar en el proyecto de la clínica.
alter table eivi.clientes add column if not exists telefono_contacto text;
