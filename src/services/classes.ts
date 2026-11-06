import { supabase } from './db';
import { check, unwrap } from '@/lib/errors';
import type { ClassRoom } from '@/types';

export interface CreateClassInput {
  name: string;
  department_id?: string | null;
  level?: string | null;
  semester_start?: string | null;
}

export async function listClasses(): Promise<ClassRoom[]> {
  const res = await supabase.from('classes').select('*, departments(name)').order('created_at', { ascending: false });
  if (res.error) {
    const fallback = await supabase.from('classes').select('*').order('created_at', { ascending: false });
    return unwrap(fallback);
  }
  return (res.data ?? []).map((c: any) => ({
    ...c,
    department_name: c.departments?.name ?? null,
  }));
}

export async function getClass(id: string): Promise<ClassRoom> {
  const res = await supabase.from('classes').select('*, departments(name)').eq('id', id).single();
  if (res.error) {
    const fallback = await supabase.from('classes').select('*').eq('id', id).single();
    return unwrap(fallback);
  }
  const raw: any = res.data;
  return {
    ...raw,
    department_name: raw?.departments?.name ?? null,
  };
}

export async function createClass(
  nameOrInput: string | CreateClassInput,
  maybeSemesterStart?: string | null,
): Promise<ClassRoom> {
  const payload =
    typeof nameOrInput === 'string'
      ? {
          name: nameOrInput.trim(),
          semester_start: maybeSemesterStart || null,
        }
      : {
          name: nameOrInput.name.trim(),
          department_id: nameOrInput.department_id || null,
          level: nameOrInput.level?.trim() || null,
          semester_start: nameOrInput.semester_start || null,
        };

  const res = await supabase.from('classes').insert(payload as any).select('*, departments(name)').single();
  if (res.error) {
    const fallback = await supabase
      .from('classes')
      .insert({
        name: payload.name,
        semester_start: payload.semester_start,
      } as any)
      .select('*')
      .single();
    return unwrap(fallback);
  }
  const raw: any = res.data;
  return {
    ...raw,
    department_name: raw?.departments?.name ?? null,
  };
}

export async function updateClass(
  id: string,
  patch: Partial<Pick<ClassRoom, 'name' | 'department_id' | 'level' | 'semester_start'>>,
): Promise<ClassRoom> {
  const res = await supabase.from('classes').update(patch as any).eq('id', id).select('*, departments(name)').single();
  if (res.error) {
    const fallback = await supabase.from('classes').update(patch as any).eq('id', id).select('*').single();
    return unwrap(fallback);
  }
  const raw: any = res.data;
  return {
    ...raw,
    department_name: raw?.departments?.name ?? null,
  };
}

export async function deleteClass(id: string): Promise<void> {
  check(await supabase.from('classes').delete().eq('id', id));
}

export function joinLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}
