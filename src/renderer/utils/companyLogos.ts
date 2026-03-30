import React from 'react';

import { ReactComponent as GoogleLogo } from '../../../assets/logos/google.svg';
import { ReactComponent as MetaLogo } from '../../../assets/logos/meta.svg';
import { ReactComponent as QwenLogo } from '../../../assets/logos/qwen.svg';
import { ReactComponent as DeepseekLogo } from '../../../assets/logos/deepseek.svg';
import { ReactComponent as KimiLogo } from '../../../assets/logos/kimi.svg';
import { ReactComponent as NvidiaLogo } from '../../../assets/logos/nvidia.svg';
import { ReactComponent as OpenAILogo } from '../../../assets/logos/openai.svg';

const COMPANY_LOGOS: Record<
  string,
  React.FunctionComponent<React.SVGProps<SVGSVGElement>>
> = {
  meta: MetaLogo,
  llama: MetaLogo,
  google: GoogleLogo,
  qwen: QwenLogo,
  deepseek: DeepseekLogo,
  kimi: KimiLogo,
  nvidia: NvidiaLogo,
  nemotron: NvidiaLogo,
  gpt: OpenAILogo
};

/**
 * Scans the full repo string for keywords.
 * If multiple keywords exist, it returns the logo for the one that appears EARLIEST in the string.
 */
export function getCompanyLogoComponent(
  repoName: string
): React.FunctionComponent<React.SVGProps<SVGSVGElement>> | null {
  const lowerName = repoName.toLowerCase();

  const bestMatch = Object.entries(COMPANY_LOGOS).reduce(
    (acc, [keyword, component]) => {
      const index = lowerName.indexOf(keyword);

      // If the keyword exists AND appears earlier than our current best match
      if (index !== -1 && index < acc.index) {
        return { match: component, index };
      }
      return acc;
    },
    {
      match: null as React.FunctionComponent<React.SVGProps<SVGSVGElement>> | null,
      index: Infinity
    }
  );

  return bestMatch.match;
}
