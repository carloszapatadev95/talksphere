import { Platform } from 'react-native';

export type OemInstruction = {
  title: string;
  steps: string[];
};

export type OemInfo = {
  manufacturer: string;
  isAggressive: boolean;
  instructions: OemInstruction[];
};

const AGGRESSIVE_OEMS: Record<string, { match: RegExp; instructions: OemInstruction[] }> = {
  xiaomi: {
    match: /xiaomi|redmi|poco/i,
    instructions: [
      {
        title: 'Auto-inicio',
        steps: [
          'Ajustes → Aplicaciones → Permisos → Auto-inicio',
          'Busca la app y actívala',
        ],
      },
      {
        title: 'Sin restricciones de batería',
        steps: [
          'Ajustes → Aplicaciones → la app → Ahorro de batería',
          'Elegí "Sin restricciones"',
        ],
      },
    ],
  },
  huawei: {
    match: /huawei|honor/i,
    instructions: [
      {
        title: 'Inicio administrado manualmente',
        steps: [
          'Ajustes → Aplicaciones → la app → Inicio de aplicaciones',
          'Desactivá "Administrar automáticamente"',
          'Activá: Inicio automático, Inicio secundario, Ejecutar en segundo plano',
        ],
      },
      {
        title: 'Batería',
        steps: [
          'Ajustes → Aplicaciones → la app → Batería',
          'Desactivá "Suspender actividad en segundo plano"',
          'Inicio → Desactivar "Ocultar" si aparece',
        ],
      },
    ],
  },
  oppo: {
    match: /oppo|oneplus|realme/i,
    instructions: [
      {
        title: 'Permitir inicio automático',
        steps: [
          'Ajustes → Administración de apps → la app → Inicio automático',
          'Permití "Inicio automático"',
        ],
      },
      {
        title: 'Batería',
        steps: [
          'Ajustes → Batería → la app',
          'Elegí "No optimizar"',
        ],
      },
    ],
  },
  vivo: {
    match: /vivo|iqoo/i,
    instructions: [
      {
        title: 'Alto consumo en segundo plano',
        steps: [
          'Ajustes → Batería → Alto consumo en segundo plano',
          'Activá el permiso para la app',
        ],
      },
      {
        title: 'Auto-inicio',
        steps: [
          'Ajustes → Aplicaciones → la app → Permiso de inicio automático',
        ],
      },
    ],
  },
  samsung: {
    match: /samsung/i,
    instructions: [
      {
        title: 'Quitar de apps inactivas',
        steps: [
          'Ajustes → Cuidado del dispositivo → Batería → Límite de uso en segundo plano',
          'Sacá la app de "Apps suspendidas" y de "Apps profundamente inactivas"',
        ],
      },
    ],
  },
  generico: {
    match: /^(doogee|ulefone|blackview|oukitel|cubot|umidigi|tecno|infinix|itel|zte|nubia|tcl|alcatel|wiko)$/i,
    instructions: [
      {
        title: 'Batería sin optimización',
        steps: [
          'Ajustes → Aplicaciones → la app → Batería',
          'Elegí "Sin restricciones" / "No optimizar"',
        ],
      },
      {
        title: 'Inicio automático (si existe)',
        steps: [
          'Ajustes → Aplicaciones → la app → Batería o Permisos',
          'Activá "Inicio automático" si la opción aparece',
        ],
      },
    ],
  },
};

export function getOemInfo(): OemInfo {
  if (Platform.OS !== 'android') {
    return { manufacturer: '', isAggressive: false, instructions: [] };
  }
  const constants = (Platform as any).constants ?? {};
  const manufacturer = String(constants.Manufacturer ?? constants.BRAND ?? '').trim();
  for (const [name, def] of Object.entries(AGGRESSIVE_OEMS)) {
    if (def.match.test(manufacturer)) {
      return { manufacturer: name.charAt(0).toUpperCase() + name.slice(1), isAggressive: true, instructions: def.instructions };
    }
  }
  return { manufacturer, isAggressive: false, instructions: [] };
}
