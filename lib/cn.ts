import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes so consumer overrides win predictably. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
