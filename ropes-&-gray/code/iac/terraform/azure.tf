# azure.tf  –  Azure demo infrastructure: RG + VNet + Windows Server 2019 VM
# Update Manager-ready: tagged, Guest agent enabled, public IP for WinRM access.
# All resources guarded by count = var.enable_azure ? 1 : 0

resource "azurerm_resource_group" "demo" {
  count    = var.enable_azure ? 1 : 0
  name     = "rg-${local.prefix}"
  location = var.azure_location
  tags     = local.common_tags
}

# ── Virtual network ───────────────────────────────────────────────────────────
resource "azurerm_virtual_network" "demo" {
  count               = var.enable_azure ? 1 : 0
  name                = "vnet-${local.prefix}"
  address_space       = ["10.20.0.0/16"]
  location            = azurerm_resource_group.demo[0].location
  resource_group_name = azurerm_resource_group.demo[0].name
  tags                = local.common_tags
}

resource "azurerm_subnet" "demo" {
  count                = var.enable_azure ? 1 : 0
  name                 = "subnet-${local.prefix}"
  resource_group_name  = azurerm_resource_group.demo[0].name
  virtual_network_name = azurerm_virtual_network.demo[0].name
  address_prefixes     = ["10.20.1.0/24"]
}

# ── Public IP for RDP / WinRM (demo only) ─────────────────────────────────────
resource "azurerm_public_ip" "demo" {
  count               = var.enable_azure ? 1 : 0
  name                = "pip-${local.prefix}"
  location            = azurerm_resource_group.demo[0].location
  resource_group_name = azurerm_resource_group.demo[0].name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.common_tags
}

resource "azurerm_network_interface" "demo" {
  count               = var.enable_azure ? 1 : 0
  name                = "nic-${local.prefix}"
  location            = azurerm_resource_group.demo[0].location
  resource_group_name = azurerm_resource_group.demo[0].name

  ip_configuration {
    name                          = "ipconfig1"
    subnet_id                     = azurerm_subnet.demo[0].id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.demo[0].id
  }
  tags = local.common_tags
}

# ── NSG: RDP (3389) + WinRM (5986) ───────────────────────────────────────────
resource "azurerm_network_security_group" "demo" {
  count               = var.enable_azure ? 1 : 0
  name                = "nsg-${local.prefix}"
  location            = azurerm_resource_group.demo[0].location
  resource_group_name = azurerm_resource_group.demo[0].name

  security_rule {
    name                       = "AllowRDP"
    priority                   = 1000
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = var.allowed_cidr
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowWinRM"
    priority                   = 1010
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5986"
    source_address_prefix      = var.allowed_cidr
    destination_address_prefix = "*"
  }

  tags = local.common_tags
}

resource "azurerm_network_interface_security_group_association" "demo" {
  count                     = var.enable_azure ? 1 : 0
  network_interface_id      = azurerm_network_interface.demo[0].id
  network_security_group_id = azurerm_network_security_group.demo[0].id
}

# ── Windows VM ────────────────────────────────────────────────────────────────
resource "azurerm_windows_virtual_machine" "demo_windows" {
  count               = var.enable_azure ? 1 : 0
  name                = "vm-${local.prefix}"
  location            = azurerm_resource_group.demo[0].location
  resource_group_name = azurerm_resource_group.demo[0].name
  size                = "Standard_B2s"
  admin_username      = var.windows_admin_username
  admin_password      = var.windows_admin_password

  network_interface_ids = [azurerm_network_interface.demo[0].id]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 128
  }

  source_image_reference {
    publisher = "MicrosoftWindowsServer"
    offer     = "WindowsServer"
    sku       = "2019-Datacenter"
    version   = "latest"
  }

  # Required for Azure Update Manager
  patch_mode                 = "AutomaticByPlatform"
  provision_vm_agent         = true
  enable_automatic_updates   = false   # AUM manages this instead

  # WinRM over HTTPS bootstrap
  winrm_listener {
    protocol = "Https"
  }

  tags = merge(local.common_tags, {
    Name         = "vm-${local.prefix}-azure"
    OS           = "Windows Server 2019"
    AnsibleGroup = "windows_azure"
    AUMEnabled   = "true"
  })
}

# ── Azure Update Manager: maintenance configuration ───────────────────────────
resource "azurerm_maintenance_configuration" "demo" {
  count               = var.enable_azure ? 1 : 0
  name                = "mc-${local.prefix}-weekly"
  resource_group_name = azurerm_resource_group.demo[0].name
  location            = azurerm_resource_group.demo[0].location
  scope               = "InGuestPatch"

  install_patches {
    windows {
      classifications_to_include = ["Critical", "Security"]
    }
    reboot = "IfRequired"
  }

  window {
    start_date_time      = "2025-01-01 02:00"
    expiration_date_time = "2030-12-31 06:00"
    duration             = "02:00"
    time_zone            = "UTC"
    recur_every          = "Week Saturday"
  }

  tags = local.common_tags
}

resource "azurerm_maintenance_assignment_virtual_machine" "demo" {
  count                        = var.enable_azure ? 1 : 0
  location                     = azurerm_resource_group.demo[0].location
  maintenance_configuration_id = azurerm_maintenance_configuration.demo[0].id
  virtual_machine_id           = azurerm_windows_virtual_machine.demo_windows[0].id
}
