-- =====================================================
-- MIGRACIÓN: Agregar Username a Tabla People
-- =====================================================
-- Ejecutar este script en: Supabase Dashboard > SQL Editor > New Query
-- Copiar todo el contenido y dar clic en "RUN"

-- 1. AGREGAR COLUMNA username A LA TABLA people
-- =====================================================
ALTER TABLE people 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Crear índice para mejorar búsquedas
CREATE INDEX IF NOT EXISTS idx_people_username ON people(username);

-- Hacer username único (pero permitir NULL para usuarios existentes)
ALTER TABLE people 
ADD CONSTRAINT unique_username UNIQUE (username);

COMMENT ON COLUMN people.username IS 'Nombre de usuario único para identificación. Se usa como integrante en grupos.';


-- 2. ACTUALIZAR TRIGGER PARA INCLUIR USERNAME
-- =====================================================
-- Reemplazar la función existente para incluir username
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insertar en people usando el email o metadata como nombre inicial
  INSERT INTO public.people (user_id, name, username)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'name',           -- Si se pasó nombre en metadata
      SPLIT_PART(NEW.email, '@', 1)              -- Si no, usar parte del email
    ),
    NEW.raw_user_meta_data->>'username'         -- Extraer username de metadata
  )
  ON CONFLICT (user_id) DO NOTHING;  -- Evitar duplicados si ya existe
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. VERIFICACIÓN
-- =====================================================
-- Ver estructura actualizada de people
SELECT column_name, data_type, is_nullable, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'people'
ORDER BY ordinal_position;

-- Ver constraints
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'people';
