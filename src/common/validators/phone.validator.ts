import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

@ValidatorConstraint({ name: 'isValidPhoneNumber', async: false })
export class IsValidPhoneNumberConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    // Simple phone number validation - customize based on your requirements
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid phone number`;
  }
}

export function IsValidPhoneNumber() {
  return function (target: object, propertyKey?: string | symbol) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyKey as string,
      constraints: [],
      validator: IsValidPhoneNumberConstraint,
    });
  };
}
