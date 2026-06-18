/**
 * Space Auto-Assignment Utility
 * Handles space naming conventions and auto-assignment logic
 */

export interface SpaceAssignmentResult {
  success: boolean;
  assignedSpace?: {
    id: number;
    code: string;
    name: string;
  };
  error?: string;
}

export interface SpaceTypeConfig {
  prefix: string;
  name: string;
  displayName: string;
}

/**
 * Space naming conventions
 * Private Rooms → 30X
 * Shared Spaces → 31X  
 * Meeting Rooms → 32X
 */
export const SPACE_TYPE_CONFIGS: Record<string, SpaceTypeConfig> = {
  'Private Office': {
    prefix: '30',
    name: 'Private Office',
    displayName: 'Private Room'
  },
  'Private Room': {
    prefix: '30', 
    name: 'Private Room',
    displayName: 'Private Room'
  },
  'Shared Space': {
    prefix: '31',
    name: 'Shared Space', 
    displayName: 'Shared Space'
  },
  'Co-Working Space': {
    prefix: '31',
    name: 'Co-Working Space',
    displayName: 'Shared Space'
  },
  'Meeting Room': {
    prefix: '32',
    name: 'Meeting Room',
    displayName: 'Meeting Room'
  },
  'Conference Room': {
    prefix: '32',
    name: 'Conference Room', 
    displayName: 'Meeting Room'
  }
};

/**
 * Get space type configuration
 */
export function getSpaceTypeConfig(spaceType: string): SpaceTypeConfig | null {
  // Direct match
  if (SPACE_TYPE_CONFIGS[spaceType]) {
    return SPACE_TYPE_CONFIGS[spaceType];
  }
  
  // Fuzzy match
  const lowerType = spaceType.toLowerCase();
  for (const [key, config] of Object.entries(SPACE_TYPE_CONFIGS)) {
    if (key.toLowerCase().includes(lowerType) || lowerType.includes(key.toLowerCase())) {
      return config;
    }
  }
  
  return null;
}

/**
 * Generate next space code based on existing spaces
 */
export function generateNextSpaceCode(spaceType: string, existingCodes: string[]): string {
  const config = getSpaceTypeConfig(spaceType);
  if (!config) {
    // Fallback to generic numbering
    return `WS${(existingCodes.length + 1).toString().padStart(3, '0')}`;
  }
  
  const prefix = config.prefix;
  const existingNumbers = existingCodes
    .filter(code => code.startsWith(prefix))
    .map(code => {
      const numPart = code.replace(prefix, '');
      return parseInt(numPart, 10);
    })
    .filter(num => !isNaN(num))
    .sort((a, b) => a - b);
  
  let nextNumber = 1;
  if (existingNumbers.length > 0) {
    // Find the first gap or use next sequential number
    for (let i = 0; i < existingNumbers.length; i++) {
      if (existingNumbers[i] !== i + 1) {
        nextNumber = i + 1;
        break;
      }
    }
    if (nextNumber === 1) {
      nextNumber = existingNumbers[existingNumbers.length - 1] + 1;
    }
  }
  
  return `${prefix}${nextNumber}`;
}

/**
 * Validate space assignment
 */
export function validateSpaceAssignment(
  spaceType: string,
  startDateTime: string,
  endDateTime: string
): { valid: boolean; error?: string } {
  if (!spaceType?.trim()) {
    return { valid: false, error: 'Space type is required' };
  }
  
  if (!startDateTime || !endDateTime) {
    return { valid: false, error: 'Start and end times are required' };
  }
  
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date/time format' };
  }
  
  if (end <= start) {
    return { valid: false, error: 'End time must be after start time' };
  }
  
  return { valid: true };
}

/**
 * Check if booking times overlap
 */
export function hasTimeOverlap(
  start1: string,
  end1: string,
  start2: string, 
  end2: string
): boolean {
  const s1 = new Date(start1);
  const e1 = new Date(end1);
  const s2 = new Date(start2);
  const e2 = new Date(end2);
  
  return s1 < e2 && s2 < e1;
}

/**
 * Get display name for space type
 */
export function getSpaceTypeDisplayName(spaceType: string): string {
  const config = getSpaceTypeConfig(spaceType);
  return config?.displayName || spaceType;
}

/**
 * Format space assignment result for display
 */
export function formatAssignmentResult(result: SpaceAssignmentResult): string {
  if (!result.success) {
    return result.error || 'Assignment failed';
  }
  
  if (result.assignedSpace) {
    return `Assigned to ${result.assignedSpace.code} - ${result.assignedSpace.name}`;
  }
  
  return 'Space assigned successfully';
}