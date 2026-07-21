-- ============================================================
-- Datos iniciales EiviLuxury (de eiviluxury.com, julio 2026)
-- REVISA Y AJUSTA: médicos por área, horarios reales y precios.
-- Ejecutar DESPUÉS de schema.sql.
-- ============================================================

insert into eivi.areas (nombre, descripcion) values
  ('Medicina Estética Facial', 'Acné, aumento de labios, líneas de expresión, manchas, mesoterapia facial, depilación láser facial'),
  ('Medicina Estética Corporal', 'Carboxiterapia, depilación láser, drenaje linfático, eliminación de tatuajes, lipoláser, mesoterapia, ozonoterapia, celulitis'),
  ('Vascular / Flebología', 'Varices, arañas vasculares, piernas cansadas, eco doppler'),
  ('Nutrición y Dietas', 'Dietas hipocalóricas, proteinadas, nutricosmética, X-Body'),
  ('Cirugía Estética y Reparadora', 'Procedimientos faciales, corporales e íntimos'),
  ('Unidad Ginecológica Antiaging', 'Rejuvenecimiento vaginal láser'),
  ('Unidad Capilar', 'Bioestimulación capilar e implantes foliculares'),
  ('Beauty Experiences', 'Cosmética personalizada, cuidados prenatales, envolturas, masajes')
on conflict (nombre) do nothing;

insert into eivi.medicos (nombre, especialidad) values
  ('Dra. María Bufí', 'Dirección médica · Medicina y Cirugía'),
  ('Dra. Deborah Bernardez', 'Cirugía Plástica'),
  ('Dr. Diogo Figueiredo', 'Medicina Estética'),
  ('Dra. Cris Herrera', 'Medicina Estética'),
  ('Dr. Enrique Llorente', 'Medicina Estética'),
  ('Dr. Ernesto Sau', 'Flebología'),
  ('Dr. Vicente Beltrán', 'Medicina Estética');

-- Asignación de áreas (AJUSTA según la realidad de la clínica)
insert into eivi.medico_areas (medico_id, area_id)
select m.id, a.id from eivi.medicos m, eivi.areas a
where (m.nombre = 'Dra. María Bufí'        and a.nombre in ('Medicina Estética Facial','Medicina Estética Corporal','Unidad Ginecológica Antiaging','Nutrición y Dietas'))
   or (m.nombre = 'Dra. Deborah Bernardez' and a.nombre in ('Cirugía Estética y Reparadora'))
   or (m.nombre = 'Dr. Diogo Figueiredo'   and a.nombre in ('Medicina Estética Facial','Medicina Estética Corporal'))
   or (m.nombre = 'Dra. Cris Herrera'      and a.nombre in ('Medicina Estética Facial','Medicina Estética Corporal'))
   or (m.nombre = 'Dr. Enrique Llorente'   and a.nombre in ('Medicina Estética Facial','Medicina Estética Corporal','Unidad Capilar'))
   or (m.nombre = 'Dr. Ernesto Sau'        and a.nombre in ('Vascular / Flebología'))
   or (m.nombre = 'Dr. Vicente Beltrán'    and a.nombre in ('Medicina Estética Facial','Medicina Estética Corporal'))
on conflict do nothing;

-- Horario de ejemplo: L-J 9-17, V 9-14 para todos (AJUSTA por médico)
insert into eivi.horarios (medico_id, dia_semana, hora_inicio, hora_fin)
select m.id, d.dia, '09:00'::time, case when d.dia = 5 then '14:00'::time else '17:00'::time end
from eivi.medicos m, (values (1),(2),(3),(4),(5)) as d(dia);

-- Tratamientos de ejemplo (precios null = requiere valoración; AJUSTA)
insert into eivi.tratamientos (area_id, nombre, descripcion, precio_eur, requiere_valoracion, duracion_min)
select a.id, t.nombre, t.descripcion, t.precio, t.valoracion, t.dur
from (values
  ('Nutrición y Dietas',            'Consulta de Nutrición',              'Primera consulta con plan personalizado', 65.00,  false, 45),
  ('Medicina Estética Facial',      'Valoración médica estética',         'Primera visita de valoración con doctor/a', null, true, 30),
  ('Medicina Estética Facial',      'Peeling Luminoso Facial',            'Peeling médico facial',                   78.65,  false, 45),
  ('Vascular / Flebología',         'Primera Visita Varices + Eco Doppler','Valoración diagnóstica vascular',        null,   true,  45),
  ('Medicina Estética Corporal',    'Fotodepilación láser (sesión)',      'Sesión de depilación láser médica',       145.20, false, 30),
  ('Beauty Experiences',            'Masaje relajante 50''',              'Masaje corporal relajante',               60.50,  false, 60)
) as t(area, nombre, descripcion, precio, valoracion, dur)
join eivi.areas a on a.nombre = t.area;

-- FAQ inicial (edítala/añade en la tabla eivi.faq)
insert into eivi.faq (pregunta, respuesta) values
  ('¿Dónde está la clínica?', 'Estamos en Carrer Canaries 41, bajo — 07800 Eivissa. Teléfonos: 971 312 902 y 673 332 003.'),
  ('¿Qué horario tenéis?', 'De lunes a jueves de 9:00 a 17:00 y viernes de 9:00 a 14:00.'),
  ('¿Cómo llego / hay parking?', 'Estamos en el centro de Eivissa; hay parking público a pocos minutos a pie.');
