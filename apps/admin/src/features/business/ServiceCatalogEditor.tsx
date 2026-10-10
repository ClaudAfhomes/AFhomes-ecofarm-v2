import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { serviceCatalogItemSchema, serviceCatalogItemInputSchema } from '@afhomes/contracts';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusChip,
  notifySuccess,
  notifyConfirm,
} from '@afhomes/ui';
import {
  createService,
  updateService,
  uploadServicePhoto,
  manageServicePhoto,
} from './points-services';
import { useSession } from '../../lib/session';
import { formatMoney } from './format';
import styles from './services.module.css';

type Service = z.infer<typeof serviceCatalogItemSchema>;

export function ServiceCatalogEditor({
  services,
  loading,
  error,
  onSaved,
}: {
  services: Service[];
  loading: boolean;
  error: Error | null;
  onSaved: () => void;
}) {
  const permission = useSession().user?.afHomesPermissions?.find(
    (p) => p.moduleKey === 'operations.catalog',
  );
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  return (
    <section aria-label="Service catalog">
      <div className={styles.header}>
        <h2>Services</h2>
        {permission?.canCreate && <Button onClick={() => setEditing('new')}>Add service</Button>}
      </div>
      {loading ? (
        <div role="status" aria-label="Loading services">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={onSaved} />
      ) : services.length === 0 ? (
        <EmptyState
          title="No services yet"
          description="Add a service, then configure its VIP discounts and earning rules below."
        />
      ) : (
        <div className={styles.cards}>
          {services.map((service) => (
            <article key={service.id} className={styles.card}>
              {service.photos[0] && (
                <img
                  src={service.photos[0].url}
                  alt={service.photos[0].alt}
                  className={styles.photo}
                />
              )}
              <h3>{service.name}</h3>
              <p>{service.description ?? 'No description yet.'}</p>
              <strong>{formatMoney(service.basePrice)}</strong>
              <div className={styles.header}>
                <StatusChip label={service.availability} />
                <StatusChip label={service.published ? 'Published' : 'Internal'} />
              </div>
              {permission?.canUpdate && (
                <Button variant="secondary" onClick={() => setEditing(service)}>
                  Edit {service.name}
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
      {editing && (
        <ServiceEditor
          key={editing === 'new' ? 'new' : editing.id}
          service={editing === 'new' ? null : editing}
          mayUpload={permission?.canUpdate === true}
          onSaved={onSaved}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function ServiceEditor({
  service,
  mayUpload,
  onSaved,
  onClose,
}: {
  service: Service | null;
  mayUpload: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(service);
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [summary, setSummary] = useState(service?.summary ?? '');
  const [category, setCategory] = useState(service?.category ?? '');
  const [location, setLocation] = useState(service?.location ?? '');
  const [pricingUnit, setPricingUnit] = useState<Service['pricingUnit']>(
    service?.pricingUnit ?? 'unit',
  );
  const [highlights, setHighlights] = useState(service?.highlights.join('\n') ?? '');
  const [replacePhotoId, setReplacePhotoId] = useState('');
  const [price, setPrice] = useState(service?.basePrice ?? '');
  const [active, setActive] = useState(service?.isActive ?? true);
  const [published, setPublished] = useState(service?.published ?? false);
  const [availability, setAvailability] = useState<Service['availability']>(
    service?.availability ?? 'available',
  );
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  /**
   * File-level problems, reported the moment a file is chosen.
   *
   * The mutation re-checks the same rules, because a client check is a courtesy
   * and the server check is the control: a browser that skips this entirely must
   * still be refused with a real message rather than a decode failure.
   */
  const [validation, setValidation] = useState<string | null>(null);
  /**
   * A local preview of the chosen file, before it is uploaded.
   *
   * A blob URL that never leaves the browser and is never persisted: only the
   * uploaded object is stored, and the editor then reads the server's own signed
   * URL back. It is revoked the instant a different file is chosen or the dialog
   * closes, so no blob URL outlives the editor.
   */
  const [preview, setPreview] = useState<string | null>(null);
  // The live object URL is held in a ref so it can be revoked without re-render:
  // blob URLs leak until revoked, and one must never outlive this editor.
  const previewUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );
  /**
   * Picking a file is where the side effect belongs: the previous preview is
   * revoked and a new one minted in the same handler. Deriving it in an effect
   * would mean a frame where the state and the URL disagree.
   */
  const chooseFile = (chosen: File | null) => {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
    setPreview(null);
    if (chosen && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(chosen);
      previewUrl.current = url;
      setPreview(url);
    }
  };
  const saved = (data: Service) => {
    setCurrent(data);
    setValidation(null);
    onSaved();
  };
  const save = useMutation({
    mutationFn: async () => {
      const parsed = serviceCatalogItemInputSchema.safeParse({
        name,
        summary: summary || null,
        category: category || null,
        location: location || null,
        pricingUnit,
        highlights: highlights
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        description: description || null,
        basePrice: price,
        isActive: active,
        published,
        availability,
      });
      if (!parsed.success)
        throw new Error('Enter a service name and an exact price, for example 1500.00.');
      return current ? updateService(current.id, parsed.data) : createService(parsed.data);
    },
    retry: false,
    onSuccess: (data) => {
      saved(data);
      notifySuccess({ title: 'Service saved' });
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!current || !file || !alt.trim())
        throw new Error('Choose an image and enter descriptive text.');
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 3 * 1024 * 1024
      )
        throw new Error('Choose a JPEG, PNG or WebP image no larger than 3 MB.');
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the image.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(file);
      });
      return uploadServicePhoto(current.id, {
        mimeType: file.type,
        dataBase64,
        alt: alt.trim(),
        ...(replacePhotoId ? { replacePhotoId } : {}),
      });
    },
    retry: false,
    onSuccess: (data) => {
      saved(data);
      setFile(null);
      chooseFile(null);
      setAlt('');
      setReplacePhotoId('');
      setValidation(null);
      notifySuccess({ title: 'Service photo saved' });
    },
  });
  const photoChange = useMutation({
    mutationFn: async ({ id, operation }: { id: string; operation: 'remove' | 'cover' }) => {
      if (!current) throw new Error('Save the service first.');
      if (
        operation === 'remove' &&
        !(await notifyConfirm({
          title: 'Remove this service photo?',
          message: 'The photo is removed from the current listing. Its audit history is retained.',
          confirmButtonText: 'Remove photo',
        }))
      )
        return null;
      return manageServicePhoto(current.id, id, operation);
    },
    retry: false,
    onSuccess: (data) => {
      if (data) {
        saved(data);
        notifySuccess({ title: 'Service photos saved' });
      }
    },
  });
  const busy = save.isPending || upload.isPending || photoChange.isPending;
  return (
    <Dialog
      open
      title={current ? `Edit ${current.name}` : 'Add service'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) save.mutate();
        }}
      >
        <label>
          Service name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
            disabled={busy}
          />
        </label>
        <label>
          Short summary
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={300}
            rows={2}
            disabled={busy}
          />
        </label>
        <label>
          Category
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            maxLength={80}
            disabled={busy}
          />
        </label>
        <label>
          Location
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={160}
            disabled={busy}
          />
        </label>
        <label>
          Pricing unit
          <select
            value={pricingUnit}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === 'person' ||
                value === 'session' ||
                value === 'night' ||
                value === 'booking' ||
                value === 'unit'
              )
                setPricingUnit(value);
            }}
            disabled={busy}
          >
            <option value="unit">Per unit</option>
            <option value="person">Per person / head</option>
            <option value="session">Per session</option>
            <option value="night">Per night</option>
            <option value="booking">Per booking</option>
          </select>
        </label>
        <label>
          Features / highlights (one per line)
          <textarea
            value={highlights}
            onChange={(event) => setHighlights(event.target.value)}
            rows={4}
            disabled={busy}
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
            rows={5}
            disabled={busy}
          />
        </label>
        <label>
          Base price
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="1500.00"
            required
            disabled={busy}
          />
        </label>
        <label>
          Availability
          <select
            value={availability}
            onChange={(event) =>
              setAvailability(
                event.target.value === 'coming_soon'
                  ? 'coming_soon'
                  : event.target.value === 'unavailable'
                    ? 'unavailable'
                    : 'available',
              )
            }
            disabled={busy}
          >
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
            <option value="coming_soon">Coming soon</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            disabled={busy}
          />
          Active service
        </label>
        <label>
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
            disabled={busy}
          />
          Publish on Experiences
        </label>
        <p>
          VIP discounts and earning rules are configured below the service catalog. Internal
          services stay private.
        </p>
        {save.isError && <p role="alert">{save.error.message}</p>}
        <Button
          type="submit"
          loading={save.isPending}
          loadingLabel={current ? 'Saving changes…' : 'Creating service…'}
          disabled={upload.isPending}
        >
          Save service
        </Button>
      </form>
      {current && mayUpload && (
        <section className={styles.form} aria-label="Service photos">
          <h3>Photos</h3>
          <div className={styles.cards}>
            {current.photos.map((photo, index) => (
              <div key={photo.url}>
                <img src={photo.url} alt={photo.alt} className={styles.photo} />
                <p>{index === 0 ? 'Cover photo' : 'Gallery photo'}</p>
                {photo.id && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setReplacePhotoId(photo.id!);
                        setAlt(photo.alt);
                      }}
                    >
                      Replace photo
                    </Button>
                    {index > 0 && (
                      <Button
                        variant="secondary"
                        loading={photoChange.isPending && photoChange.variables?.id === photo.id}
                        loadingLabel="Setting cover…"
                        disabled={busy}
                        onClick={() => photoChange.mutate({ id: photo.id!, operation: 'cover' })}
                      >
                        Set as cover
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      loading={photoChange.isPending && photoChange.variables?.id === photo.id}
                      loadingLabel="Removing…"
                      disabled={busy}
                      onClick={() => photoChange.mutate({ id: photo.id!, operation: 'remove' })}
                    >
                      Remove photo
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          <label>
            Image file
            <input
              key={current.photos.length}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFile(chosen);
                chooseFile(chosen);
                // Reported here rather than only on submit, so a rejected file is
                // explained before anyone waits on an upload that cannot succeed.
                setValidation(
                  !chosen
                    ? null
                    : !['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type) ||
                        chosen.size > 3 * 1024 * 1024
                      ? 'Choose a JPEG, PNG or WebP image no larger than 3 MB.'
                      : null,
                );
              }}
              disabled={busy || (current.photos.length >= 6 && !replacePhotoId)}
            />
          </label>
          {/* The preview is what the admin is about to upload, shown BEFORE the
              upload so a wrong image is caught here rather than after it has been
              stored. It is a revoked blob URL, never the persisted reference. */}
          {preview && (
            <figure className={styles.preview}>
              <img src={preview} alt="Selected image preview" className={styles.photo} />
              <figcaption>Preview — not uploaded yet.</figcaption>
            </figure>
          )}
          <label>
            Image description
            <input
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              maxLength={200}
              disabled={busy}
            />
          </label>
          <p>
            Up to six images, 3 MB each. Photos become public only with a published, active service.
          </p>
          {validation && <p role="alert">{validation}</p>}
          {upload.isError && <p role="alert">{upload.error.message}</p>}
          {/* Byte-level progress is not available over this transport, so the
              honest signal is the button itself: it disables itself, shows a
              spinner and announces the wait, and it recovers on both success and
              failure. A fake percentage would be a lie the admin acts on. */}
          <Button
            variant="secondary"
            onClick={() => upload.mutate()}
            loading={upload.isPending}
            loadingLabel="Uploading photo…"
            disabled={save.isPending || !file || !alt.trim() || current.photos.length >= 6}
          >
            Upload photo
          </Button>
        </section>
      )}
    </Dialog>
  );
}
