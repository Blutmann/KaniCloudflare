import type { SVGAttributes } from 'react';
import * as Flags from 'country-flag-icons/react/3x2';
import { hasFlag } from 'country-flag-icons';

export interface CountryFlagProps extends SVGAttributes<SVGElement> {
  code?: string | null | undefined;
  fallbackFlag?: string | undefined;
  className?: string | undefined;
  title?: string | undefined;
}

export function CountryFlag({
  code,
  fallbackFlag,
  className = 'phone-country-flag-svg',
  title,
  ...rest
}: CountryFlagProps) {
  const upperCode = code?.toUpperCase();
  if (upperCode && hasFlag(upperCode)) {
    const FlagComponent = (Flags as Record<string, ((props: SVGAttributes<SVGElement>) => React.JSX.Element) | undefined>)[upperCode];
    if (FlagComponent) {
      return (
        <FlagComponent
          className={className}
          title={title ?? upperCode}
          aria-hidden="true"
          {...rest}
        />
      );
    }
  }

  if (fallbackFlag) {
    return (
      <span className={className} aria-hidden="true">
        {fallbackFlag}
      </span>
    );
  }

  return null;
}
