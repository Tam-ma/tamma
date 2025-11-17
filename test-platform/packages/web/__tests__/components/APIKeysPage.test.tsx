import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { APIKeysPage } from '@/pages/settings/APIKeysPage';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('APIKeysPage', () => {
  it('renders the page title and description', () => {
    render(<APIKeysPage />, { wrapper: createWrapper() });

    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.getByText(/Manage your API keys/i)).toBeInTheDocument();
  });

  it('displays the Generate New Key button', () => {
    render(<APIKeysPage />, { wrapper: createWrapper() });

    const button = screen.getByRole('button', { name: /Generate New Key/i });
    expect(button).toBeInTheDocument();
  });

  it('opens the generate key modal when button is clicked', async () => {
    const user = userEvent.setup();
    render(<APIKeysPage />, { wrapper: createWrapper() });

    const button = screen.getByRole('button', { name: /Generate New Key/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('Generate API Key')).toBeInTheDocument();
    });
  });

  it('displays search input', () => {
    render(<APIKeysPage />, { wrapper: createWrapper() });

    const searchInput = screen.getByPlaceholderText(/Search API keys/i);
    expect(searchInput).toBeInTheDocument();
  });

  it('displays summary statistics cards', () => {
    render(<APIKeysPage />, { wrapper: createWrapper() });

    expect(screen.getByText('Total Keys')).toBeInTheDocument();
    expect(screen.getByText('Active Keys')).toBeInTheDocument();
    expect(screen.getByText(/Total Requests/i)).toBeInTheDocument();
    expect(screen.getByText(/Success Rate/i)).toBeInTheDocument();
  });
});
