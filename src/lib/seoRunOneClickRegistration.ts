type UnknownRecord = Record<string, unknown>;

export function shouldAutoQueueShoplingRegistration(
  inputPayload: unknown,
) {
  return (
    !!inputPayload &&
    typeof inputPayload === "object" &&
    !Array.isArray(inputPayload) &&
    (inputPayload as UnknownRecord).autoQueueShoplingRegistration === true
  );
}

export function buildSeoRunAutoRegistrationPatch(
  inputPayload: unknown,
  registrationStatus: string,
  registrationPayload: unknown,
  completedAt: string,
) {
  if (
    registrationStatus !== "idle" ||
    !shouldAutoQueueShoplingRegistration(inputPayload)
  ) {
    return {};
  }
  const previous =
    registrationPayload &&
    typeof registrationPayload === "object" &&
    !Array.isArray(registrationPayload)
      ? (registrationPayload as UnknownRecord)
      : {};
  return {
    registration_status: "queued" as const,
    registration_payload: {
      ...previous,
      autoQueuedAt: completedAt,
      autoQueueSource: "product_launch_tracker_one_click",
    },
  };
}
