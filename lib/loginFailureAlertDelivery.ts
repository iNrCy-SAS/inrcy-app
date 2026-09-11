import {
  buildLoginFailureAlertMail,
  getLoginFailureThreshold,
  type LoginFailureCategory,
  type LoginFailureMailInput,
} from "./loginFailureAlertPolicy.ts";

export type LoginFailureMailClaim = {
  key: string;
  remote: boolean;
  token: string;
};

export type LoginFailureMailClaimDecision =
  | { status: "acquired"; claim: LoginFailureMailClaim }
  | { status: "sent" }
  | { status: "pending" };

export type LoginFailureDeliveryDependencies = {
  increment: (input: LoginFailureMailInput) => Promise<number>;
  claim: (input: LoginFailureMailInput) => Promise<LoginFailureMailClaimDecision>;
  commit: (claim: LoginFailureMailClaim) => Promise<void>;
  release: (claim: LoginFailureMailClaim) => Promise<void>;
  reserveGlobalCapacity: () => Promise<boolean>;
  sendMail: (mail: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }) => Promise<void>;
  destination: string;
};

export function getLoginFailureCounterKey(
  userId: string,
  category: LoginFailureCategory,
) {
  return `login-failure-count:v1:${userId}:${category}`;
}

export async function resetLoginFailureCounters(
  userId: string,
  categories: readonly LoginFailureCategory[],
  dependencies: {
    clearLocal: (keys: readonly string[]) => void;
    clearRemote: (keys: readonly string[]) => Promise<void>;
  },
) {
  const keys = categories.map((category) =>
    getLoginFailureCounterKey(userId, category),
  );
  dependencies.clearLocal(keys);
  await dependencies.clearRemote(keys);
}

export async function deliverLoginFailureAlert(
  input: LoginFailureMailInput,
  dependencies: LoginFailureDeliveryDependencies,
) {
  const failureCount = await dependencies.increment(input);
  const threshold = getLoginFailureThreshold(input.category);
  if (failureCount < threshold) {
    return {
      status: "below_threshold",
      failureCount,
      threshold,
    } as const;
  }

  const decision = await dependencies.claim(input);
  if (decision.status === "sent") {
    return { status: "deduplicated", failureCount, threshold } as const;
  }
  if (decision.status === "pending") {
    return { status: "in_flight", failureCount, threshold } as const;
  }
  const claim = decision.claim;

  if (!(await dependencies.reserveGlobalCapacity())) {
    await dependencies.release(claim);
    return { status: "globally_limited", failureCount, threshold } as const;
  }

  try {
    const mail = buildLoginFailureAlertMail({ ...input, failureCount });
    await dependencies.sendMail({
      to: dependencies.destination,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    await dependencies.commit(claim);
    return { status: "sent", failureCount, threshold } as const;
  } catch (error) {
    await dependencies.release(claim);
    throw error;
  }
}
