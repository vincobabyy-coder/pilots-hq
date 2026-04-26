export type FieldError = { field: string; message: string }
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldError[] }

class StringValidator {
  private _required = false
  private _minLength?: number
  private _maxLength?: number
  private _isEmail = false
  private _isUuid = false

  required(): this { this._required = true; return this }
  min(n: number): this { this._minLength = n; return this }
  max(n: number): this { this._maxLength = n; return this }
  email(): this { this._isEmail = true; return this }
  uuid(): this { this._isUuid = true; return this }

  validate(value: unknown, field: string): FieldError[] {
    const errors: FieldError[] = []
    if (value === undefined || value === null || value === '') {
      if (this._required) errors.push({ field, message: `${field} is required` })
      return errors
    }
    if (typeof value !== 'string') {
      errors.push({ field, message: `${field} must be a string` }); return errors
    }
    if (this._minLength !== undefined && value.length < this._minLength)
      errors.push({ field, message: `${field} must be at least ${this._minLength} characters` })
    if (this._maxLength !== undefined && value.length > this._maxLength)
      errors.push({ field, message: `${field} must be at most ${this._maxLength} characters` })
    if (this._isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      errors.push({ field, message: `${field} must be a valid email address` })
    if (this._isUuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      errors.push({ field, message: `${field} must be a valid UUID` })
    return errors
  }
}

class NumberValidator {
  private _required = false
  private _min?: number
  private _max?: number

  required(): this { this._required = true; return this }
  min(n: number): this { this._min = n; return this }
  max(n: number): this { this._max = n; return this }

  validate(value: unknown, field: string): FieldError[] {
    const errors: FieldError[] = []
    if (value === undefined || value === null) {
      if (this._required) errors.push({ field, message: `${field} is required` })
      return errors
    }
    if (typeof value !== 'number' || isNaN(value)) {
      errors.push({ field, message: `${field} must be a number` }); return errors
    }
    if (this._min !== undefined && value < this._min)
      errors.push({ field, message: `${field} must be >= ${this._min}` })
    if (this._max !== undefined && value > this._max)
      errors.push({ field, message: `${field} must be <= ${this._max}` })
    return errors
  }
}

type AnyValidator = StringValidator | NumberValidator | ObjectValidator

class ObjectValidator {
  private _required = false
  constructor(private shape: Record<string, AnyValidator>) {}

  required(): this { this._required = true; return this }

  validate(value: unknown, field: string): FieldError[] {
    const errors: FieldError[] = []
    if (value === undefined || value === null) {
      if (this._required) errors.push({ field, message: `${field} is required` })
      return errors
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ field, message: `${field} must be an object` }); return errors
    }
    const obj = value as Record<string, unknown>
    for (const [key, validator] of Object.entries(this.shape)) {
      errors.push(...validator.validate(obj[key], field === 'root' ? key : `${field}.${key}`))
    }
    return errors
  }

  parse(input: unknown): ValidationResult<Record<string, unknown>> {
    const errors = this.validate(input, 'root')
    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, data: input as Record<string, unknown> }
  }
}

export const v = {
  string: () => new StringValidator(),
  number: () => new NumberValidator(),
  object: (shape: Record<string, AnyValidator>) => new ObjectValidator(shape),
}
