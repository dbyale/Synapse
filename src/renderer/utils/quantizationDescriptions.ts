export interface QuantizationInfo {
  filename: string;
  details: string[];
}

export function parseQuantization(
  filename: string,
  quantization: string,
  isProjector: boolean = false,
): QuantizationInfo {
  const info: QuantizationInfo = { filename, details: [] };

  const upperQ = quantization ? quantization.toUpperCase() : '';

  // Always include the projector tag if it falls in that category
  if (isProjector || upperQ === 'MMPROJ') {
    info.details.push(
      'Multimodal Projector (used for vision/image capabilities)',
    );
  }

  // If there's no quantization string, or it's purely "MMPROJ", we can stop here
  if (!quantization || upperQ === 'MMPROJ') {
    return info;
  }

  // 1. Extract Format and Bits (e.g., Q4, IQ3, FP16)
  const baseMatch = upperQ.split('_')[0].match(/^([A-Z]+)(\d+)?$/);
  if (baseMatch) {
    const [, prefix, bits] = baseMatch;
    const bitText = bits ? `${bits}-bit` : '';

    if (prefix === 'Q') info.details.push(`${bitText} Standard Format`.trim());
    else if (prefix === 'IQ')
      info.details.push(
        `${bitText} I-Quant (Importance Matrix, higher quality)`.trim(),
      );
    else if (prefix === 'FP' || prefix === 'F')
      info.details.push(
        `${bitText} Floating Point (Unquantized precision)`.trim(),
      );
    else if (prefix === 'BF')
      info.details.push(
        `${bitText} Brain Floating Point (AI-optimized precision)`.trim(),
      );
    else info.details.push(`${bitText} ${prefix}`.trim());
  }

  // 2. Parse remaining modifiers (e.g., K, M, XXS)
  const tokens = upperQ.split('_').slice(1);
  for (const token of tokens) {
    switch (token) {
      // Methods
      case 'K':
        info.details.push(
          'K-Quant (uses different precision across the model for better quality)',
        );
        break;
      case 'NL':
        info.details.push(
          'Nonlinear Quantization (better accuracy by focusing precision where it matters)',
        );
        break;
      case '0':
        info.details.push('Legacy Type 0 (older method, lower quality)');
        break;
      case '1':
        info.details.push('Legacy Type 1 (higher accuracy than Type 0)');
        break;

      // Sizes
      case 'XXS':
        info.details.push('Extra Extra Small (maximum compression)');
        break;
      case 'XS':
        info.details.push('Extra Small');
        break;
      case 'S':
        info.details.push('Small (favors smaller file size)');
        break;
      case 'M':
        info.details.push('Medium (recommended balance)');
        break;
      case 'L':
        info.details.push('Large (favors quality over size)');
        break;
      case 'XL':
        info.details.push('Extra Large (maximum quality for this bit-rate)');
        break;
    }
  }

  return info;
}
