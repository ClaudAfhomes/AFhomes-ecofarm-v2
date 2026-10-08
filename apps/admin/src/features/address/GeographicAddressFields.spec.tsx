import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { renderWithProviders } from '../../test/utils.js';
import * as services from './services.js';
import { GeographicAddressFields, type AddressGeography } from './GeographicAddressFields.js';

const LAGUNA = { code: '0403400000', name: 'Laguna' };
const BATANGAS = { code: '0406100000', name: 'Batangas' };
const CALAUAN = {
  code: '0403406000',
  name: 'Calauan',
  type: 'municipality' as const,
  provinceCode: LAGUNA.code,
};
const BINAN = {
  code: '0403403000',
  name: 'City of Biñan',
  type: 'city' as const,
  provinceCode: LAGUNA.code,
};
const LEMERY = {
  code: '0406110000',
  name: 'Lemery',
  type: 'municipality' as const,
  provinceCode: BATANGAS.code,
};
const DAYAP = { code: '0403406003', name: 'Dayap', localityCode: CALAUAN.code };
const POBLACION = { code: '0403406004', name: 'Poblacion', localityCode: CALAUAN.code };

const EMPTY: AddressGeography = {};

beforeEach(() => {
  vi.spyOn(services, 'getAddressProvinces').mockResolvedValue([LAGUNA, BATANGAS]);
  vi.spyOn(services, 'getAddressLocalities').mockImplementation(async (code: string) =>
    code === LAGUNA.code ? [CALAUAN, BINAN] : [LEMERY],
  );
  vi.spyOn(services, 'getAddressBarangays').mockImplementation(async (code: string) =>
    code === CALAUAN.code ? [DAYAP, POBLACION] : [],
  );
});

/**
 * The component is CONTROLLED, exactly like the `HolderFields` it drops into -
 * the form owns the holder slice. So the harness owns it too, otherwise a
 * selection would call `onChange` and never land anywhere, which is how this
 * file first "passed" against a permanently empty address.
 */
function Controlled({
  initial,
  onChange,
}: {
  initial: AddressGeography;
  onChange: (next: AddressGeography) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <GeographicAddressFields
      idPrefix="primary"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function setup(value: AddressGeography = EMPTY) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<Controlled initial={value} onChange={onChange} />);
  return { onChange, user };
}

const province = () => screen.getByRole('combobox', { name: /^Province/ });
const locality = () => screen.getByRole('combobox', { name: /City \/ municipality/ });
const barangay = () => screen.getByRole('combobox', { name: /^Barangay/ });

/**
 * `name` is a matcher because a locality's accessible name deliberately includes
 * its type ("Calauan (municipality)") - the distinction is part of the answer.
 */
const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  name: string | RegExp,
) => {
  // A real user cannot click a control that has not unlocked yet; waiting here
  // models that, instead of racing the cascade.
  await waitFor(() => expect(box).toBeEnabled());
  await user.click(box);
  await user.click(await screen.findByRole('option', { name }));
};

describe('GeographicAddressFields structure', () => {
  it('offers all three levels', () => {
    setup();
    expect(province()).toBeInTheDocument();
    expect(locality()).toBeInTheDocument();
    expect(barangay()).toBeInTheDocument();
  });

  it('does not fetch the province list until the selector is used', async () => {
    // The address block is one part of a long form. Fetching a reference list on
    // mount means every screen pays for it, and a transient failure puts a live
    // region on a form the operator never touched.
    const { user } = setup();
    expect(services.getAddressProvinces).not.toHaveBeenCalled();

    await user.click(province());

    await waitFor(() => expect(services.getAddressProvinces).toHaveBeenCalledTimes(1));
  });

  it('will not let a child be chosen before its parent exists', () => {
    setup();
    expect(locality()).toBeDisabled();
    expect(barangay()).toBeDisabled();
  });

  it('says why a level is unavailable', () => {
    setup();
    expect(screen.getAllByText('Select a province first').length).toBeGreaterThan(0);
  });

  it('keeps a city visibly distinct from a municipality', async () => {
    const { user } = setup();

    await choose(user, province(), 'Laguna');
    await user.click(locality());

    const options = await screen.findAllByRole('option');
    expect(within(options[0]!).getByText('municipality')).toBeInTheDocument();
    expect(within(options[1]!).getByText('city')).toBeInTheDocument();
  });
});

describe('GeographicAddressFields cascade', () => {
  it('enables localities only once a province is chosen', async () => {
    const { user } = setup();

    await choose(user, province(), 'Laguna');

    await waitFor(() => expect(locality()).toBeEnabled());
    expect(barangay()).toBeDisabled();
  });

  it('enables barangays only once a locality is chosen', async () => {
    const { user } = setup();

    await choose(user, province(), 'Laguna');
    await choose(user, locality(), /^Calauan/);

    await waitFor(() => expect(barangay()).toBeEnabled());
  });

  it('shows only the chosen province’s localities', async () => {
    const { user } = setup();

    await choose(user, province(), 'Laguna');
    await user.click(locality());

    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Calauan'),
      expect.stringContaining('City of Biñan'),
    ]);
  });

  it('emits the province code and its official name', async () => {
    const { user, onChange } = setup();

    await choose(user, province(), 'Laguna');

    expect(onChange).toHaveBeenCalledWith({
      province: 'Laguna',
      provinceCode: '0403400000',
      cityMunicipality: undefined,
      cityMunicipalityCode: undefined,
      barangay: undefined,
      barangayCode: undefined,
    });
  });

  it('clears locality and barangay when the province changes', async () => {
    const { user, onChange } = setup({
      province: 'Laguna',
      provinceCode: LAGUNA.code,
      cityMunicipality: 'Calauan',
      cityMunicipalityCode: CALAUAN.code,
      barangay: 'Dayap',
      barangayCode: DAYAP.code,
    });

    await choose(user, province(), 'Batangas');

    // A child of the OLD province must never survive under the new one.
    expect(onChange).toHaveBeenCalledWith({
      province: 'Batangas',
      provinceCode: BATANGAS.code,
      cityMunicipality: undefined,
      cityMunicipalityCode: undefined,
      barangay: undefined,
      barangayCode: undefined,
    });
    await waitFor(() => expect(barangay()).toBeDisabled());
  });

  it('clears barangay when the locality changes', async () => {
    const { user, onChange } = setup({
      province: 'Laguna',
      provinceCode: LAGUNA.code,
      cityMunicipality: 'Calauan',
      cityMunicipalityCode: CALAUAN.code,
      barangay: 'Dayap',
      barangayCode: DAYAP.code,
    });

    await choose(user, locality(), /^City of Biñan/);

    expect(onChange).toHaveBeenCalledWith({
      province: 'Laguna',
      provinceCode: LAGUNA.code,
      cityMunicipality: 'City of Biñan',
      cityMunicipalityCode: BINAN.code,
      barangay: undefined,
      barangayCode: undefined,
    });
  });

  it('emits the full verified triple once all three are chosen', async () => {
    const { user, onChange } = setup();

    await choose(user, province(), 'Laguna');
    await choose(user, locality(), /^Calauan/);
    await choose(user, barangay(), 'Dayap');

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        province: 'Laguna',
        provinceCode: '0403400000',
        cityMunicipality: 'Calauan',
        cityMunicipalityCode: '0403406000',
        barangay: 'Dayap',
        barangayCode: '0403406003',
      }),
    );
  });
});

describe('GeographicAddressFields failure states', () => {
  it('offers a retry when the localities cannot be loaded', async () => {
    vi.spyOn(services, 'getAddressLocalities').mockRejectedValue(new Error('down'));
    const { user } = setup();

    await choose(user, province(), 'Laguna');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /unable to load cities and municipalities/i,
    );
  });

  it('does not show a raw upstream message', async () => {
    vi.spyOn(services, 'getAddressBarangays').mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432'),
    );
    const { user } = setup();

    await choose(user, province(), 'Laguna');
    await choose(user, locality(), /^Calauan/);

    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('10.0.0.5');
  });
});

describe('GeographicAddressFields legacy records', () => {
  it('renders a stored free-text address without inventing a code', () => {
    setup({ province: 'LAGUNA', cityMunicipality: 'CALAMBA' });

    expect(province()).toHaveValue('LAGUNA');
    expect(locality()).toHaveValue('CALAMBA');
    expect(locality()).toBeDisabled();
  });

  it('says plainly that the stored address is not code-verified', () => {
    setup({ province: 'LAGUNA' });

    expect(screen.getAllByText(/not linked to an official code/i).length).toBeGreaterThan(0);
  });

  it('does not claim a legacy address is verified', () => {
    setup({ province: 'LAGUNA', provinceCode: undefined });

    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('lets a legacy record be upgraded by choosing an official province', async () => {
    const { user, onChange } = setup({ province: 'LAGUNA', cityMunicipality: 'CALAMBA' });

    await choose(user, province(), 'Laguna');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ province: 'Laguna', provinceCode: '0403400000' }),
    );
  });

  it('does not force a legacy record to gain codes in order to save', () => {
    // Nothing here writes a code on its own; absence is a valid state.
    const { onChange } = setup({ province: 'LAGUNA' });
    expect(onChange).not.toHaveBeenCalled();
  });
});