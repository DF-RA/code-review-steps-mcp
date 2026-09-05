/**
 * Error whose message is meant to be read by the user or the model.
 * Tools turn these into a result with isError: true instead of letting them
 * bubble up as a protocol failure.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
