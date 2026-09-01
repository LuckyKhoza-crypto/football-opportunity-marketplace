"use client";

import { ApplyButton } from "./ApplyButton";

interface ApplyButtonWrapperProps {
  opportunityId: string;
  opportunityTitle: string;
}

export function ApplyButtonWrapper({
  opportunityId,
  opportunityTitle,
}: ApplyButtonWrapperProps) {
  return (
    <ApplyButton
      opportunityId={opportunityId}
      opportunityTitle={opportunityTitle}
    />
  );
}