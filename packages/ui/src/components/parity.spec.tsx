import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import * as React from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  Alert,
  AuthLayout,
  FilterBar,
  FormField,
  MetricCard,
  PasswordField,
  SearchField,
  TextField,
} from '../index';

const renderWithRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AuthLayout (JAD parity shell)', () => {
  it('renders the mobile masthead, brand panel, and a single h1', () => {
    render(
      <AuthLayout eyebrow="AF Homes Ecofarm" title="Staff sign in" brandTitle="Grow.">
        <form />
      </AuthLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Staff sign in' })).toBeInTheDocument();
    // Mobile masthead + desktop brand panel + form eyebrow share the eyebrow text.
    expect(screen.getAllByText('AF Homes Ecofarm').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Grow.')).toBeInTheDocument();
  });

  it('marks every auth screen noindex, nofollow', () => {
    render(
      <AuthLayout eyebrow="AF Homes Ecofarm" title="Staff sign in" brandTitle="Grow.">
        <form />
      </AuthLayout>,
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  it('supports the wide form panel and lead text', () => {
    const { container } = render(
      <AuthLayout
        eyebrow="AF Homes Ecofarm"
        title="Activate your account"
        lead="Use your code."
        brandTitle="Brand."
        wide
      >
        <form />
      </AuthLayout>,
    );
    expect(screen.getByText('Use your code.')).toBeInTheDocument();
    expect(container.querySelector('[class*="formPanelWide"]')).not.toBeNull();
  });

  it('renders the breadcrumb slot at the very top of the form card', () => {
    render(
      <AuthLayout
        eyebrow="AF Homes Ecofarm"
        title="Staff sign in"
        brandTitle="Grow."
        breadcrumb={
          <nav aria-label="Breadcrumb">
            <span aria-current="page">Staff Login</span>
          </nav>
        }
      >
        <form />
      </AuthLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Staff sign in' });
    expect(nav.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('FormField / TextField', () => {
  it('wires label, hint, and error with describedby', () => {
    render(
      <FormField id="f" label="Email" hint="Hint" error="Bad">
        <input id="f" />
      </FormField>,
    );
    expect(screen.getByText('Bad')).toHaveAttribute('role', 'alert');
  });

  it('renders a text input with error and aria wiring', async () => {
    const user = userEvent.setup();
    let value = '';
    render(
      <TextField
        id="tf"
        name="tf"
        label="Email"
        value={value}
        onChange={(next) => {
          value = next;
        }}
        error="Enter email."
      />,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'tf-error');
    await user.type(input, 'x');
    expect(value).toBe('x');
  });
});

describe('PasswordField', () => {
  it('toggles visibility through an accessible button', async () => {
    const user = userEvent.setup();
    render(
      <PasswordField
        id="pw"
        label="Password"
        value="secret"
        onChange={() => undefined}
        autoComplete="current-password"
      />,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('Alert', () => {
  it('announces danger assertively and info politely', () => {
    render(
      <>
        <Alert variant="danger" title="Failed">
          Nope.
        </Alert>
        <Alert variant="info">Heads up.</Alert>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    expect(screen.getByRole('status')).toHaveTextContent('Heads up.');
  });
});

describe('MetricCard (JAD QueueCard grammar)', () => {
  it('renders icon, value, label, and description', () => {
    renderWithRouter(
      <MetricCard label="Pending payments" value={7} icon="clock" description="Awaiting review" />,
    );
    expect(screen.getByText('Pending payments')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
  });

  it('renders as a link with an accessible label when `to` is set', () => {
    renderWithRouter(<MetricCard label="Card sales" value={3} to="/admin/sales" />);
    expect(screen.getByRole('link', { name: 'Card sales: 3' })).toHaveAttribute(
      'href',
      '/admin/sales',
    );
  });

  it('renders an optional status chip', () => {
    renderWithRouter(
      <MetricCard
        label="Registrations"
        value={2}
        chip={{ label: 'action needed', tone: 'warning' }}
      />,
    );
    expect(screen.getByText('action needed')).toBeInTheDocument();
  });
});

describe('FilterBar', () => {
  it('renders search, filters, and actions in one toolbar', () => {
    render(
      <FilterBar
        search={<input aria-label="Search" />}
        filters={<select aria-label="Status" />}
        actions={<button>Clear</button>}
      />,
    );
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });
});

describe('SearchField', () => {
  it('renders a labelled search input with a decorative icon', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = React.useState('');
      return (
        <SearchField
          label="Search staff"
          value={value}
          onChange={setValue}
          placeholder="Search name or email"
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText('Search staff');
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('placeholder', 'Search name or email');
    await user.type(input, 'ana');
    expect(input).toHaveValue('ana');
  });
});
