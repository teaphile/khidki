import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { DP_ACCEPT, prepareDpImage } from '../../lib/dp';
import { Avatar } from './Avatar';

type Props = {
  name: string;
  seed: string;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
};

export function DpUploadControl({ name, seed, value, onChange, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setProcessing(true);
    setError(null);
    try {
      const result = await prepareDpImage(file);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange(result.dataUrl);
    } finally {
      setProcessing(false);
    }
  };

  const handleRemove = () => {
    setError(null);
    onChange(null);
  };

  return (
    <div className="dp-control">
      <div className="dp-control__main">
        <Avatar name={name || 'You'} seed={seed || 'khidki'} dpUrl={value} size="lg" />
        <div className="dp-control__copy">
          <strong>DP</strong>
          <span>Optional display picture. Any image format works.</span>
          <div className="dp-control__actions">
            <input
              ref={inputRef}
              type="file"
              accept={DP_ACCEPT}
              onChange={handleFileChange}
              hidden
            />
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || processing}
            >
              {processing ? (
                <Loader2 className="spin" size={15} aria-hidden="true" />
              ) : (
                <ImagePlus size={15} aria-hidden="true" />
              )}
              {value ? 'Change DP' : 'Upload DP'}
            </button>
            {value ? (
              <button
                type="button"
                className="button button--ghost button--sm dp-control__remove"
                onClick={handleRemove}
                disabled={disabled || processing}
              >
                <Trash2 size={14} aria-hidden="true" />
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? (
        <p className="dp-control__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
