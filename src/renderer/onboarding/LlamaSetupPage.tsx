import { ArrowLeft, Bot } from 'lucide-react';

export default function LlamaSetupPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="onb-page">
      <div className="onb-llama">
        <div className="onb-llama-icon onb-rise">
          <Bot size={44} strokeWidth={1.75} />
        </div>
        <h1 className="onb-llama-title onb-rise onb-delay-1">llamaSetup</h1>
        <p className="onb-llama-text onb-rise onb-delay-2">
          This page is a placeholder for the Llama setup flow. Configuration for
          your local Llama runtime will live here.
        </p>
        <button
          type="button"
          className="onb-back-btn onb-rise onb-delay-3"
          onClick={onBack}
        >
          <ArrowLeft size={16} strokeWidth={2} />
          Back to setup experience
        </button>
      </div>
    </div>
  );
}
