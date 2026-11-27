import { useState, type FormEvent, type FocusEvent } from 'react';
import {
  validateAuthForm,
  type AuthMode,
  type AuthField,
  type AuthErrors,
} from './form-validation';

export function useAuthValidation(mode: AuthMode, token = '') {
  const [errors, setErrors] = useState<AuthErrors>({});
  function read(form: HTMLFormElement) {
    return validateAuthForm(
      mode,
      Object.fromEntries(new FormData(form)),
      token,
    );
  }
  function validate(form: HTMLFormElement) {
    const result = read(form);
    setErrors(result.errors);
    const first = (
      ['displayName', 'email', 'password', 'confirmPassword'] as const
    ).find((field) => result.errors[field]);
    if (first)
      requestAnimationFrame(() =>
        (form.elements.namedItem(first) as HTMLInputElement | null)?.focus(),
      );
    return result;
  }
  function blur(event: FocusEvent<HTMLFormElement>) {
    if (event.currentTarget.querySelector('fieldset')?.disabled) return;
    const field = event.target.name as AuthField;
    if (
      !['displayName', 'email', 'password', 'confirmPassword'].includes(field)
    )
      return;
    const result = read(event.currentTarget);
    setErrors((previous) =>
      previous[field] === result.errors[field]
        ? previous
        : { ...previous, [field]: result.errors[field] },
    );
  }
  function change(event: FormEvent<HTMLFormElement>) {
    if (event.currentTarget.querySelector('fieldset')?.disabled) return;
    const field = (event.target as HTMLInputElement).name as AuthField;
    const confirmation = event.currentTarget.elements.namedItem(
      'confirmPassword',
    ) as HTMLInputElement | null;
    const checkConfirmation = field === 'password' && !!confirmation?.value;
    // Untouched fields validate on blur/submit. Avoid a full schema parse and
    // React update on every keystroke until feedback actually needs refreshing.
    if (!errors[field] && !errors.confirmPassword && !checkConfirmation) return;
    const result = read(event.currentTarget);
    setErrors((previous) => {
      const next = {
        ...previous,
        ...(previous[field] ? { [field]: result.errors[field] } : {}),
        ...(previous.confirmPassword || checkConfirmation
          ? { confirmPassword: result.errors.confirmPassword }
          : {}),
      };
      return previous[field] === next[field] &&
        previous.confirmPassword === next.confirmPassword
        ? previous
        : next;
    });
  }
  return { errors, validate, blur, change };
}
