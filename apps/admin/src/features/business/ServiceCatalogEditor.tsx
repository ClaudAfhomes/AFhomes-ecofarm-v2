import { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { z } from 'zod';
import { serviceCatalogItemSchema, serviceCatalogItemInputSchema } from '@afhomes/contracts';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FileField,
  FilterBar,
  OverflowMenu,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextAreaField,
  TextField,
  notifySuccess,
  notifyConfirm,
} from '@afhomes/ui';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import {
  createService,
  updateService,
  uploadServicePhoto,
  manageServicePhoto,
} from './points-services';
import { useSession } from '../../lib/session';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import styles from './services.module.css';
import catalogStyles from './points.module.css';

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
  const [detail, setDetail] = useState<Service | null>(null);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  void useDebouncedValue(search.trim(), 300, setApplied);
  const term = applied.toLowerCase();
  const visible = useMemo(
    () =>
      term.length === 0
        ? services
        : services.filter(
            (service) =>
              service.name.toLowerCase().includes(term) ||
              (service.category ?? '').toLowerCase().includes(term),
          ),
    [services, term],
  );
  const activeCount = useMemo(() => visible.filter((s) => s.isActive).length, [visible]);
  return (
    <section aria-label="Service catalog" className={catalogStyles.section}>
      <div className={styles.header}>
        <h2 className={catalogStyles.sectionTitle}>Services</h2>
        {permission?.canCreate && <Button onClick={() => setEditing('new')}>Add service</Button>}
      </div>
      <Alert variant="info" title="Catalog drives every sale">
        Prices and points here are database-backed. Editing a service never rewrites a recorded
        sale; it only affects future purchases.
      </Alert>
      {!loading && !error && services.length > 0 ? (
        <ul className={catalogStyles.badges} aria-label="Catalog summary">
          <li>
            <StatusChip
              label={`Services: ${formatCountOrDash(visible.length)}`}
              tone="neutral"
              icon="grid"
            />
          </li>
          <li>
            <StatusChip
              label={`Active: ${formatCountOrDash(activeCount)}`}
              tone="success"
              icon="check"
            />
          </li>
        </ul>
      ) : null}
      {!loading && !error && services.length > 0 ? (
        <FilterBar
          filtersToggleLabel="Expand Filters"
          search={
            <SearchField
              label="Search services"
              placeholder="Service name or category"
              value={search}
              onChange={setSearch}
            />
          }
        />
      ) : null}
      {loading ? (
        <div role="status" aria-label="Loading services">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={onSaved} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No services yet"
          description="Add a service, then configure its VIP discounts and earning rules below."
        />
      ) : (
        <div className={styles.cards}>
          {visible.map((service) => (
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
              <strong>{formatMoneyOrDash(service.basePrice)}</strong>
              <div className={styles.header}>
                <StatusChip label={capitalizeStatus(service.availability)} />
                <StatusChip
                  label={service.published ? 'Published' : 'Internal'}
                  tone={service.published ? 'success' : 'neutral'}
                />
                {service.isStaycationEligible && (
                  <StatusChip label="Points-eligible stay" tone="info" />
                )}
                <StatusChip
                  label={service.isActive ? 'Active' : 'Inactive'}
                  tone={service.isActive ? 'success' : 'neutral'}
                />
              </div>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <Button variant="secondary" onClick={() => setDetail(service)}>
                  View details
                </Button>
                {permission?.canUpdate && (
                  <Button variant="secondary" onClick={() => setEditing(service)}>
                    Edit {service.name}
                  </Button>
                )}
                <OverflowMenu
                  label={`More actions for ${service.name}`}
                  items={[
                    {
                      label: 'View details',
                      icon: 'info',
                      onClick: () => setDetail(service),
                    },
                  ]}
                />
              </span>
            </article>
          ))}
        </div>
      )}
      {detail ? (
        <Dialog
          open
          onClose={() => setDetail(null)}
          title={detail.name}
          footer={
            <>
              {permission?.canUpdate ? (
                <Button
                  onClick={() => {
                    setEditing(detail);
                    setDetail(null);
                  }}
                >
                  Edit {detail.name}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Close
              </Button>
            </>
          }
        >
          {detail.photos[0] ? (
            <img src={detail.photos[0].url} alt={detail.photos[0].alt} className={styles.photo} />
          ) : null}
          <dl className={catalogStyles.figures}>
            <div>
              <dt>Base price</dt>
              <dd>{formatMoneyOrDash(detail.basePrice)}</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>
                <StatusChip label={capitalizeStatus(detail.availability)} />
              </dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>
                <StatusChip
                  label={detail.published ? 'Published' : 'Internal'}
                  tone={detail.published ? 'success' : 'neutral'}
                />
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusChip
                  label={detail.isActive ? 'Active' : 'Inactive'}
                  tone={detail.isActive ? 'success' : 'neutral'}
                />
              </dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>{detail.description ?? 'No description yet.'}</dd>
            </div>
          </dl>
          <p className={catalogStyles.hint}>
            This record is read-only here. Use the menu action to edit it.
          </p>
        </Dialog>
      ) : null}
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

function capitalizeStatus(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
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
  const [staycationEligible, setStaycationEligible] = useState(
    service?.isStaycationEligible ?? false,
  );
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
  const save = useBusinessMutation({
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
        isStaycationEligible: staycationEligible,
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
  const upload = useBusinessMutation({
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
  const photoChange = useBusinessMutation({
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
        <TextField
          id="service-name"
          name="serviceName"
          label="Service name"
          value={name}
          onChange={setName}
          maxLength={120}
          disabled={busy}
        />
        <TextAreaField
          id="service-summary"
          name="summary"
          label="Short summary"
          optional
          value={summary}
          onChange={setSummary}
          maxLength={300}
          rows={2}
          disabled={busy}
        />
        <TextField
          id="service-category"
          name="category"
          label="Category"
          optional
          value={category}
          onChange={setCategory}
          maxLength={80}
          disabled={busy}
        />
        <TextField
          id="service-location"
          name="location"
          label="Location"
          optional
          value={location}
          onChange={setLocation}
          maxLength={160}
          disabled={busy}
        />
        <label>
          Pricing unit
          <Select
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
            options={[
              { value: 'unit', label: 'Per unit' },
              { value: 'person', label: 'Per person / head' },
              { value: 'session', label: 'Per session' },
              { value: 'night', label: 'Per night' },
              { value: 'booking', label: 'Per booking' },
            ]}
          />
        </label>
        <TextAreaField
          id="service-highlights"
          name="highlights"
          label="Features / highlights (one per line)"
          optional
          value={highlights}
          onChange={setHighlights}
          rows={4}
          disabled={busy}
        />
        <TextAreaField
          id="service-description"
          name="description"
          label="Description"
          optional
          value={description}
          onChange={setDescription}
          maxLength={5000}
          rows={5}
          disabled={busy}
        />
        <TextField
          id="service-base-price"
          name="basePrice"
          label="Base price"
          inputMode="decimal"
          placeholder="1500.00"
          value={price}
          onChange={setPrice}
          disabled={busy}
        />
        <label>
          Availability
          <Select
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
            options={[
              { value: 'available', label: 'Available' },
              { value: 'unavailable', label: 'Unavailable' },
              { value: 'coming_soon', label: 'Coming soon' },
            ]}
          />
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
            checked={staycationEligible}
            onChange={(event) => setStaycationEligible(event.target.checked)}
            disabled={busy}
          />
          Staycation or hotel accommodation — usable with VIP points without a promotion
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
          <FileField
            key={current.photos.length}
            id="service-photo"
            name="photo"
            label="Image file"
            optional
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || (current.photos.length >= 6 && !replacePhotoId)}
            onSelect={(chosen) => {
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
          />
          {/* The preview is what the admin is about to upload, shown BEFORE the
              upload so a wrong image is caught here rather than after it has been
              stored. It is a revoked blob URL, never the persisted reference. */}
          {preview && (
            <figure className={styles.preview}>
              <img src={preview} alt="Selected image preview" className={styles.photo} />
              <figcaption>Preview — not uploaded yet.</figcaption>
            </figure>
          )}
          <TextField
            id="service-photo-alt"
            name="photoAlt"
            label="Image description"
            optional
            value={alt}
            onChange={setAlt}
            maxLength={200}
            disabled={busy}
          />
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
