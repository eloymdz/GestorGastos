-- =====================================================
-- MIGRACIÓN: Integración Usuario-Integrante
-- =====================================================
-- Ejecutar este script en: Supabase Dashboard > SQL Editor > New Query
-- Copiar todo el contenido y dar clic en "RUN"

-- 1. AGREGAR COLUMNA user_id A LA TABLA people
-- =====================================================
ALTER TABLE people 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Crear índice para mejorar búsquedas
CREATE INDEX IF NOT EXISTS idx_people_user_id ON people(user_id);

-- Hacer user_id único (un usuario solo puede tener un perfil de persona)
ALTER TABLE people 
ADD CONSTRAINT unique_user_id UNIQUE (user_id);

COMMENT ON COLUMN people.user_id IS 'Vinculación con usuario autenticado. NULL para invitados sin cuenta.';


-- 2. TRIGGER PARA AUTO-CREAR PEOPLE AL REGISTRARSE
-- =====================================================
-- Función que se ejecuta cuando un nuevo usuario se registra
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insertar en people usando el email o metadata como nombre inicial
  INSERT INTO public.people (user_id, name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'name',           -- Si se pasó nombre en metadata
      SPLIT_PART(NEW.email, '@', 1)              -- Si no, usar parte del email
    )
  )
  ON CONFLICT (user_id) DO NOTHING;  -- Evitar duplicados si ya existe
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger que llama a la función después de insertar usuario
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- 3. ACTUALIZAR POLÍTICAS RLS PARA people
-- =====================================================
-- Permitir que usuarios autenticados vean todos los perfiles (para agregar a grupos)
DROP POLICY IF EXISTS "Users can view all people" ON people;
CREATE POLICY "Users can view all people"
  ON people FOR SELECT
  USING (auth.role() = 'authenticated');

-- Permitir que usuarios actualicen solo SU PROPIO perfil
DROP POLICY IF EXISTS "Users can update own profile" ON people;
CREATE POLICY "Users can update own profile"
  ON people FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Permitir insertar personas (para invitados sin cuenta)
DROP POLICY IF EXISTS "Authenticated users can insert people" ON people;
CREATE POLICY "Authenticated users can insert people"
  ON people FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');


-- 4. ACTUALIZAR POLÍTICAS RLS PARA groups
-- =====================================================
-- Los usuarios ven:
-- 1. Sus propios grupos (creados por ellos)
-- 2. Grupos públicos donde son MIEMBROS

DROP POLICY IF EXISTS "Users can view own and member groups" ON groups;
CREATE POLICY "Users can view own and member groups"
  ON groups FOR SELECT
  USING (
    auth.uid() = created_by  -- Grupos propios
    OR (
      is_public = true  -- Grupos públicos...
      AND EXISTS (  -- ...donde soy miembro
        SELECT 1 FROM group_members gm
        JOIN people p ON gm.person_id = p.id
        WHERE gm.group_id = groups.id
        AND p.user_id = auth.uid()
      )
    )
  );


-- 5. VERIFICACIÓN
-- =====================================================
-- Ejecutar esto para verificar que todo está correcto:

-- Ver estructura de people
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'people'
ORDER BY ordinal_position;

-- Ver triggers activos
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Ver políticas RLS de people
SELECT schemaname, tablename, policyname, permissive, roles
FROM pg_policies
WHERE tablename = 'people';
